import { world, system, EntityDamageCause, EntitySwingSource, EquipmentSlot, GameMode } from "@minecraft/server";

// ===== ตั้งค่า =====
const SWEEP_RANGE = 3.5; // ระยะกวาด (บล็อก) วัดจากตัวผู้เล่นไปข้างหน้า
const SWEEP_HALF_ANGLE = 70; // ครึ่งมุมกวาดซ้าย-ขวา (องศา) 70 = กวาดกว้าง 140°
const SWEEP_HEIGHT = 2.5; // ศัตรูต้องสูง/ต่ำกว่าผู้เล่นไม่เกินนี้
const SWEEP_DAMAGE_RATIO = 0.5; // ศัตรูตัวรอบข้างโดน 1 + (ดาเมจดาบ x ค่านี้)
const COOLDOWN_TICKS = 12; // หน่วงระหว่างการกวาด (20 tick = 1 วินาที) ดาบ PC = 0.625 วิ
const KNOCKBACK = 0.4; // แรงกระเด็นของศัตรูที่โดนกวาด
const HIT_PLAYERS = false; // true = กวาดโดนผู้เล่นคนอื่นด้วย (PvP)
const HIT_OWN_PETS = false; // true = กวาดโดนสัตว์เลี้ยงของตัวเองด้วย

// ดาเมจพื้นฐานของดาบ (ค่าตาม Bedrock)
const SWORD_DAMAGE = {
  "minecraft:wooden_sword": 5,
  "minecraft:golden_sword": 5,
  "minecraft:stone_sword": 6,
  "minecraft:copper_sword": 6,
  "minecraft:iron_sword": 7,
  "minecraft:diamond_sword": 8,
  "minecraft:netherite_sword": 9,
};
const DEFAULT_SWORD_DAMAGE = 6; // ดาบจาก addon อื่นที่ไม่อยู่ในตาราง

// สิ่งที่ไม่ควรโดนกวาด
const IGNORED_TYPES = new Set([
  "minecraft:item",
  "minecraft:xp_orb",
  "minecraft:arrow",
  "minecraft:thrown_trident",
  "minecraft:armor_stand",
  "minecraft:painting",
  "minecraft:leash_knot",
  "minecraft:ender_crystal",
]);
// ===================

const lastSweepTick = new Map(); // player.id -> tick ที่กวาดล่าสุด
const pending = new Map(); // player.id -> { player, hitEntity } รอประมวลผลใน tick ถัดไป

function isSword(item) {
  if (!item) return false;
  return item.typeId.endsWith("_sword") || item.hasTag("minecraft:is_sword");
}

function getMainhand(player) {
  return player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
}

function enchantLevel(item, id) {
  try {
    return item.getComponent("minecraft:enchantable")?.getEnchantment(id)?.level ?? 0;
  } catch {
    return 0;
  }
}

function attackDamage(player, item) {
  let damage = SWORD_DAMAGE[item.typeId] ?? DEFAULT_SWORD_DAMAGE;
  damage += enchantLevel(item, "sharpness") * 1.25;
  const strength = player.getEffect("strength");
  if (strength) damage += 3 * (strength.amplifier + 1);
  const weakness = player.getEffect("weakness");
  if (weakness) damage -= 4 * (weakness.amplifier + 1);
  return Math.max(1, damage);
}

function canHit(player, entity) {
  if (!entity.isValid || entity.id === player.id) return false;
  if (IGNORED_TYPES.has(entity.typeId)) return false;
  if (!entity.getComponent("minecraft:health")) return false;
  if (entity.typeId === "minecraft:player") {
    if (!HIT_PLAYERS) return false;
    const mode = entity.getGameMode();
    if (mode === GameMode.Creative || mode === GameMode.Spectator) return false;
  }
  if (!HIT_OWN_PETS && entity.getComponent("minecraft:tameable")?.tamedToPlayerId === player.id) return false;
  return true;
}

// หาศัตรูทั้งหมดในรูปพัดด้านหน้าผู้เล่น
function findTargets(player) {
  const view = player.getViewDirection();
  const flat = Math.hypot(view.x, view.z);
  // มองขึ้น/ลงตรง ๆ ใช้ทิศที่ตัวหันแทน
  const fx = flat > 0.01 ? view.x / flat : -Math.sin((player.getRotation().y * Math.PI) / 180);
  const fz = flat > 0.01 ? view.z / flat : Math.cos((player.getRotation().y * Math.PI) / 180);
  const cosLimit = Math.cos((SWEEP_HALF_ANGLE * Math.PI) / 180);
  const origin = player.location;
  const head = player.getHeadLocation();

  const targets = [];
  for (const entity of player.dimension.getEntities({ location: origin, maxDistance: SWEEP_RANGE + 1.5 })) {
    if (!canHit(player, entity)) continue;
    const loc = entity.location;
    const dx = loc.x - origin.x;
    const dz = loc.z - origin.z;
    const dy = loc.y - origin.y;
    if (Math.abs(dy) > SWEEP_HEIGHT) continue;
    // หักครึ่งความกว้างตัวมอนโดยประมาณ ให้ตัวใหญ่ ๆ โดนง่ายขึ้น
    const dist = Math.hypot(dx, dz);
    if (dist - 0.5 > SWEEP_RANGE) continue;
    // ตัวที่ชิดมาก ๆ ถือว่าอยู่ข้างหน้าเสมอ
    if (dist > 0.8 && (dx * fx + dz * fz) / dist < cosLimit) continue;

    // ห้ามตีทะลุกำแพง
    const center = { x: loc.x, y: loc.y + 0.6, z: loc.z };
    const ray = { x: center.x - head.x, y: center.y - head.y, z: center.z - head.z };
    const rayLen = Math.hypot(ray.x, ray.y, ray.z);
    if (rayLen > 0.1) {
      const hit = player.dimension.getBlockFromRay(
        head,
        { x: ray.x / rayLen, y: ray.y / rayLen, z: ray.z / rayLen },
        { maxDistance: rayLen, includePassableBlocks: false, includeLiquidBlocks: false }
      );
      if (hit) continue;
    }

    const facing = dist > 0.01 ? (dx * fx + dz * fz) / dist : 1;
    targets.push({ entity, dist, dx, dz, score: dist * (2 - facing) });
  }
  return { targets, fx, fz };
}

// ระยะถึงบล็อกที่ผู้เล่นกำลังมอง (ใช้แยกว่ากำลังขุดหรือกำลังตี)
function lookedBlockDistance(player) {
  const hit = player.getBlockFromViewDirection({ maxDistance: 6, includeLiquidBlocks: false, includePassableBlocks: false });
  if (!hit) return Infinity;
  const head = player.getHeadLocation();
  const p = { x: hit.block.location.x + hit.faceLocation.x, y: hit.block.location.y + hit.faceLocation.y, z: hit.block.location.z + hit.faceLocation.z };
  return Math.hypot(p.x - head.x, p.y - head.y, p.z - head.z);
}

function damageSword(player, item) {
  if (player.getGameMode() === GameMode.Creative) return;
  const durability = item.getComponent("minecraft:durability");
  if (!durability) return;
  const chance = durability.getDamageChance(enchantLevel(item, "unbreaking"));
  if (Math.random() * 100 >= chance) return;
  const equippable = player.getComponent("minecraft:equippable");
  if (durability.damage + 1 >= durability.maxDurability) {
    equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
    player.dimension.playSound("random.break", player.location);
    return;
  }
  durability.damage += 1;
  equippable.setEquipment(EquipmentSlot.Mainhand, item);
}

function playSweepEffect(player, fx, fz, hitSomething) {
  const dim = player.dimension;
  const base = player.location;
  const y = base.y + 1.1;
  // วาดเส้นโค้งเป็นรูปพัดด้านหน้า
  const yaw = Math.atan2(fz, fx);
  for (let i = -3; i <= 3; i++) {
    const a = yaw + (i / 3) * ((SWEEP_HALF_ANGLE * Math.PI) / 180) * 0.8;
    const r = 1.8;
    try {
      dim.spawnParticle("minecraft:critical_hit_emitter", { x: base.x + Math.cos(a) * r, y, z: base.z + Math.sin(a) * r });
    } catch {}
  }
  dim.playSound(hitSomething ? "game.player.attack.strong" : "game.player.attack.nodamage", base, { volume: 0.8 });
}

function doSweep(player, directHit) {
  if (!player.isValid) return;
  const mode = player.getGameMode();
  if (mode === GameMode.Spectator) return;
  const item = getMainhand(player);
  if (!isSword(item)) return;

  const now = system.currentTick;
  const last = lastSweepTick.get(player.id) ?? -Infinity;
  if (now - last < COOLDOWN_TICKS) return;

  const { targets, fx, fz } = findTargets(player);

  // ถ้าไม่ได้ตีโดนมอนตรง ๆ และบล็อกที่มองอยู่ใกล้กว่ามอนทุกตัว = กำลังขุดบล็อก ไม่กวาด
  if (!directHit) {
    const nearest = targets.reduce((m, t) => Math.min(m, t.dist), Infinity);
    if (lookedBlockDistance(player) < Math.min(nearest, SWEEP_RANGE + 1)) return;
  }

  lastSweepTick.set(player.id, now);

  // ตัวหลัก: ตัวที่ตีโดนจริง หรือตัวที่อยู่ตรงหน้าที่สุด (ไม่ต้องเล็ง)
  let main = directHit;
  if (!main && targets.length > 0) main = targets.reduce((a, b) => (b.score < a.score ? b : a)).entity;

  const fullDamage = attackDamage(player, item);
  const sweepDamage = 1 + fullDamage * SWEEP_DAMAGE_RATIO;
  const fireAspect = enchantLevel(item, "fire_aspect");
  let hitAny = Boolean(directHit);

  for (const t of targets) {
    const e = t.entity;
    if (directHit && e.id === directHit.id) continue; // เกมตีตัวนี้ไปแล้ว
    const isMain = main && e.id === main.id;
    const ok = e.applyDamage(isMain ? fullDamage : sweepDamage, {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: player,
    });
    if (!ok || !e.isValid) continue;
    hitAny = true;
    const len = t.dist > 0.01 ? t.dist : 1;
    const kx = t.dist > 0.01 ? t.dx / len : fx;
    const kz = t.dist > 0.01 ? t.dz / len : fz;
    try {
      e.applyKnockback({ x: kx * KNOCKBACK, z: kz * KNOCKBACK }, 0.25);
    } catch {}
    if (fireAspect > 0) e.setOnFire(fireAspect * 4, true);
  }

  // เกมลดความทนทานให้เองแล้วตอนตีโดนตรง ๆ
  if (hitAny && !directHit) damageSword(player, getMainhand(player) ?? item);
  playSweepEffect(player, fx, fz, hitAny);
}

function queue(player, hitEntity) {
  const entry = pending.get(player.id);
  if (entry) {
    if (hitEntity) entry.hitEntity = hitEntity;
    return;
  }
  pending.set(player.id, { player, hitEntity });
  // รอ 1 tick เพื่อให้รู้ว่าการแกว่งครั้งนี้ตีโดนมอนตรง ๆ หรือไม่
  system.run(() => {
    const e = pending.get(player.id);
    pending.delete(player.id);
    if (e) doSweep(e.player, e.hitEntity?.isValid ? e.hitEntity : undefined);
  });
}

// กดตี (แตะจอ/คลิกซ้าย) ทุกครั้ง แม้ไม่โดนอะไรเลย
world.afterEvents.playerSwingStart.subscribe((ev) => {
  if (ev.swingSource !== EntitySwingSource.Attack) return; // ขุดบล็อก/วางบล็อก/ใช้ไอเท็ม ไม่กวาด
  if (!isSword(ev.heldItemStack)) return;
  queue(ev.player, undefined);
});

// ตีโดนมอนตรง ๆ (เกมทำดาเมจให้ตัวนั้นแล้ว เรากวาดตัวรอบ ๆ ต่อ)
world.afterEvents.entityHitEntity.subscribe((ev) => {
  const player = ev.damagingEntity;
  if (player.typeId !== "minecraft:player") return;
  if (!isSword(getMainhand(player))) return;
  queue(player, ev.hitEntity);
});

world.afterEvents.playerLeave.subscribe((ev) => {
  lastSweepTick.delete(ev.playerId);
  pending.delete(ev.playerId);
});

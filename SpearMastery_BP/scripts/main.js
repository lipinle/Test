import { world, system, EntityDamageCause, EntitySwingSource, EquipmentSlot, GameMode } from "@minecraft/server";

// ===== ตั้งค่า =====
const LOCK_RANGE = 20; // ระยะล็อกเป้า (บล็อก)
const LOCK_ANGLE = 45; // ศัตรูต้องอยู่ในกรวยกี่องศาจากกลางจอถึงจะล็อกได้ (ครึ่งมุม)
const KEEP_LOCK_ANGLE = 80; // ล็อกแล้วหันออกได้ถึงกี่องศาก่อนเป้าจะหลุด
const LUNGE_EXTRA = 4; // เป้าไกลเกินระยะแทงไม่เกินเท่านี้ จะพุ่งเข้าไปแทง
const PIERCE_LENGTH = 3; // แทงทะลุไปด้านหลังเป้ากี่บล็อก
const PIERCE_RATIO = 0.6; // ศัตรูด้านหลังโดนกี่เท่าของดาเมจหลัก
const THROW_COOLDOWN = 60; // ขว้างหอกวิญญาณ (20 tick = 1 วินาที)
const RAIN_COOLDOWN = 300; // ฝนหอก
const RAIN_CHARGE_TICKS = 20; // ต้องกดใช้ค้างนานเท่านี้แล้วปล่อย ถึงจะออกฝนหอก
const RAIN_RADIUS = 5; // รัศมีของฝนหอก
const SLAM_COOLDOWN = 40; // กระแทกพื้น
const SLAM_MIN_HEIGHT = 2.5; // ต้องอยู่สูงจากพื้นอย่างน้อยเท่านี้ถึงจะกระแทกพื้นได้
const SHOW_HUD = true; // แสดงเป้า/คูลดาวน์เหนือแถบไอเท็ม
const HIT_PLAYERS = false; // true = ล็อก/โจมตีผู้เล่นคนอื่นได้ (PvP)
const HIT_OWN_PETS = false; // true = สกิลโดนสัตว์เลี้ยงของตัวเองด้วย
const LOCK_PASSIVE_MOBS = false; // true = ล็อกสัตว์ทั่วไปได้ (ปกติล็อกแค่มอนสเตอร์ และตัวที่เราตีใส่ก่อน)

// ค่าของหอกแต่ละชนิด
//   damage = ดาเมจแทงอัตโนมัติ      reach  = ระยะแทง (บล็อก)
//   jabCd  = หน่วงระหว่างการแทง (tick) throw  = ดาเมจหอกวิญญาณ
//   pierce = หอกวิญญาณทะลุได้อีกกี่ตัว  rain   = ดาเมจฝนหอกต่อเล่ม   spears = จำนวนเล่ม
//   lightning = ฝนหอกเรียกสายฟ้าลงกลางวง
const SPEAR_TIERS = {
  "minecraft:wooden_spear": { damage: 4, reach: 4.5, jabCd: 12, throw: 5, pierce: 0, rain: 4, spears: 5 },
  "minecraft:golden_spear": { damage: 4, reach: 5.0, jabCd: 9, throw: 6, pierce: 0, rain: 5, spears: 6 },
  "minecraft:stone_spear": { damage: 5, reach: 5.0, jabCd: 12, throw: 6, pierce: 0, rain: 5, spears: 6 },
  "minecraft:copper_spear": { damage: 5, reach: 5.5, jabCd: 11, throw: 7, pierce: 1, rain: 6, spears: 7 },
  "minecraft:iron_spear": { damage: 6, reach: 6.0, jabCd: 11, throw: 8, pierce: 1, rain: 7, spears: 8 },
  "minecraft:diamond_spear": { damage: 7, reach: 6.5, jabCd: 10, throw: 10, pierce: 2, rain: 8, spears: 10 },
  "minecraft:netherite_spear": { damage: 8, reach: 7.0, jabCd: 10, throw: 12, pierce: 3, rain: 10, spears: 12, lightning: true },
};
const DEFAULT_TIER = { damage: 5, reach: 5.0, jabCd: 12, throw: 6, pierce: 0, rain: 5, spears: 6 }; // หอกจาก addon อื่น

const IGNORED_TYPES = new Set([
  "minecraft:item",
  "minecraft:xp_orb",
  "minecraft:arrow",
  "minecraft:thrown_trident",
  "minecraft:armor_stand",
  "minecraft:painting",
  "minecraft:leash_knot",
  "minecraft:ender_crystal",
  "minecraft:lightning_bolt",
]);
// ===================

const locks = new Map(); // player.id -> entity ที่ล็อกอยู่
const provoked = new Map(); // player.id -> { id, until } ตัวที่เราตีใส่ก่อน (ล็อกได้แม้ไม่ใช่มอนสเตอร์)
const cooldowns = new Map(); // player.id -> { jab, throw, rain, slam } tick ที่ใช้ได้อีกครั้ง
const pending = new Map(); // player.id -> { player, hitEntity } รอประมวลผลการแตะตีใน tick ถัดไป
const useStart = new Map(); // player.id -> tick ที่เริ่มกดใช้ค้าง
const slams = new Map(); // player.id -> { startY, ticks, tier }

// ---------- เวกเตอร์ ----------
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a) => Math.hypot(a.x, a.y, a.z);
const normalize = (a) => {
  const l = length(a);
  return l > 1e-6 ? mul(a, 1 / l) : { x: 0, y: 0, z: 1 };
};
const DOWN = { x: 0, y: -1, z: 0 };

// ---------- ตัวช่วย ----------
function isSpear(item) {
  if (!item) return false;
  return item.typeId.endsWith("_spear") || item.hasTag("minecraft:is_spear");
}

function getMainhand(player) {
  return player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
}

function getTier(item) {
  return SPEAR_TIERS[item.typeId] ?? DEFAULT_TIER;
}

function enchantLevel(item, id) {
  try {
    return item.getComponent("minecraft:enchantable")?.getEnchantment(id)?.level ?? 0;
  } catch {
    return 0;
  }
}

// ดาเมจ + Sharpness + ยาพลังโจมตี/อ่อนแรง
function scaleDamage(player, item, base) {
  let damage = base + enchantLevel(item, "sharpness") * 1.25;
  const strength = player.getEffect("strength");
  if (strength) damage += 3 * (strength.amplifier + 1);
  const weakness = player.getEffect("weakness");
  if (weakness) damage -= 4 * (weakness.amplifier + 1);
  return Math.max(1, damage);
}

function particle(dim, id, loc) {
  try {
    dim.spawnParticle(id, loc);
  } catch {}
}

function sound(dim, id, loc, volume = 1) {
  try {
    dim.playSound(id, loc, { volume });
  } catch {}
}

function bodyCenter(entity) {
  const loc = entity.location;
  let height = 1.6;
  try {
    height = entity.getHeadLocation().y - loc.y;
  } catch {}
  return { x: loc.x, y: loc.y + Math.max(0.3, height * 0.7), z: loc.z };
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

function isLockable(player, entity) {
  if (LOCK_PASSIVE_MOBS || entity.typeId === "minecraft:player") return true;
  const p = provoked.get(player.id);
  if (p && p.id === entity.id && system.currentTick < p.until) return true;
  return entity.getComponent("minecraft:type_family")?.hasTypeFamily("monster") ?? false;
}

// มีบล็อกขวางระหว่าง 2 จุดหรือไม่
function clearPath(dim, from, to) {
  const ray = sub(to, from);
  const dist = length(ray);
  if (dist < 0.1) return true;
  try {
    const hit = dim.getBlockFromRay(from, mul(ray, 1 / dist), {
      maxDistance: dist,
      includePassableBlocks: false,
      includeLiquidBlocks: false,
    });
    return !hit;
  } catch {
    return false;
  }
}

// ระยะถึงบล็อกที่ผู้เล่นกำลังมอง (แยกว่ากำลังขุดหรือกำลังตี)
function lookedBlockDistance(player) {
  const hit = player.getBlockFromViewDirection({ maxDistance: 8, includeLiquidBlocks: false, includePassableBlocks: false });
  if (!hit) return Infinity;
  const p = add(hit.block.location, hit.faceLocation);
  return length(sub(p, player.getHeadLocation()));
}

function groundBelow(dim, loc, maxDistance = 24) {
  try {
    const hit = dim.getBlockFromRay(loc, DOWN, { maxDistance, includePassableBlocks: false, includeLiquidBlocks: true });
    if (hit) return hit.block.location.y + 1;
  } catch {}
  return undefined;
}

function getCooldowns(player) {
  let cd = cooldowns.get(player.id);
  if (!cd) {
    cd = { jab: 0, throw: 0, rain: 0, slam: 0 };
    cooldowns.set(player.id, cd);
  }
  return cd;
}

function ready(player, skill) {
  return system.currentTick >= getCooldowns(player)[skill];
}

function startCooldown(player, skill, ticks) {
  getCooldowns(player)[skill] = system.currentTick + ticks;
}

function wearSpear(player, amount) {
  if (player.getGameMode() === GameMode.Creative) return;
  const item = getMainhand(player);
  if (!isSpear(item)) return;
  const durability = item.getComponent("minecraft:durability");
  if (!durability) return;
  const chance = durability.getDamageChance(enchantLevel(item, "unbreaking"));
  let wear = 0;
  for (let i = 0; i < amount; i++) if (Math.random() * 100 < chance) wear++;
  if (wear === 0) return;
  const equippable = player.getComponent("minecraft:equippable");
  if (durability.damage + wear >= durability.maxDurability) {
    equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
    sound(player.dimension, "random.break", player.location);
    return;
  }
  durability.damage += wear;
  equippable.setEquipment(EquipmentSlot.Mainhand, item);
}

function hurt(player, entity, damage, item) {
  if (!entity.isValid) return false;
  const ok = entity.applyDamage(damage, { cause: EntityDamageCause.entityAttack, damagingEntity: player });
  if (ok && entity.isValid && item) {
    const fire = enchantLevel(item, "fire_aspect");
    if (fire > 0) entity.setOnFire(fire * 4, true);
  }
  return ok;
}

function knockback(entity, dir, horizontal, vertical) {
  const flat = Math.hypot(dir.x, dir.z);
  if (flat < 1e-6) return;
  try {
    entity.applyKnockback({ x: (dir.x / flat) * horizontal, z: (dir.z / flat) * horizontal }, vertical);
  } catch {}
}

// ---------- ล็อกเป้า ----------
function findLockTarget(player) {
  const dim = player.dimension;
  const head = player.getHeadLocation();
  const view = player.getViewDirection();
  const prev = locks.get(player.id);
  const cosNew = Math.cos((LOCK_ANGLE * Math.PI) / 180);
  const cosKeep = Math.cos((KEEP_LOCK_ANGLE * Math.PI) / 180);

  let best;
  let bestScore = Infinity;
  for (const entity of dim.getEntities({ location: head, maxDistance: LOCK_RANGE })) {
    if (!canHit(player, entity)) continue;
    const isPrev = prev?.isValid && prev.id === entity.id;
    if (!isPrev && !isLockable(player, entity)) continue;
    const c = bodyCenter(entity);
    const toward = sub(c, head);
    const dist = length(toward);
    const cos = dist > 0.01 ? dot(toward, view) / dist : 1;
    // ตัวที่ชิดตัวมาก ๆ แค่อยู่ด้านหน้าก็พอ
    const limit = dist < 3 ? 0 : isPrev ? cosKeep : cosNew;
    if (cos < limit) continue;
    if (!clearPath(dim, head, c)) continue;
    // ใกล้กลางจอ + ใกล้ตัว = ดีที่สุด, ตัวเดิมได้เปรียบเพื่อไม่ให้เป้ากระโดดไปมา
    let score = dist + (1 - cos) * 25;
    if (isPrev) score *= 0.6;
    if (score < bestScore) {
      bestScore = score;
      best = entity;
    }
  }
  if (best) locks.set(player.id, best);
  else locks.delete(player.id);
  return best;
}

// ---------- แทงอัตโนมัติ + แทงทะลุ ----------
function strike(player, target, item, tier, alreadyHit) {
  const dim = player.dimension;
  const head = player.getHeadLocation();
  const c = bodyCenter(target);
  const dir = normalize(sub(c, head));
  const damage = scaleDamage(player, item, tier.damage);

  if (!alreadyHit) {
    if (hurt(player, target, damage, item)) knockback(target, dir, 0.45, 0.2);
    // เส้นแทงจากปลายหอกถึงเป้า
    const dist = length(sub(c, head));
    for (let d = 1; d < dist; d += 0.7) particle(dim, "minecraft:basic_crit_particle", add(head, mul(dir, d)));
    sound(dim, "game.player.attack.strong", c);
  }
  particle(dim, "minecraft:critical_hit_emitter", c);

  // แทงทะลุ: ศัตรูที่อยู่ในแนวเดียวกันด้านหลังเป้า
  const targetDist = length(sub(c, head));
  for (const e of dim.getEntities({ location: c, maxDistance: PIERCE_LENGTH + 1.5 })) {
    if (e.id === target.id || !canHit(player, e)) continue;
    const ec = bodyCenter(e);
    const rel = sub(ec, head);
    const along = dot(rel, dir);
    if (along <= targetDist || along > targetDist + PIERCE_LENGTH) continue;
    const side = length(sub(rel, mul(dir, along)));
    if (side > 1.2) continue;
    if (hurt(player, e, damage * PIERCE_RATIO, item)) {
      knockback(e, dir, 0.35, 0.15);
      particle(dim, "minecraft:critical_hit_emitter", ec);
    }
  }
  if (!alreadyHit) wearSpear(player, 1);
}

// พุ่งเข้าหาเป้าที่อยู่ไกลกว่าระยะแทงเล็กน้อย แล้วแทงเมื่อถึงตัว
function lunge(player, target, item, tier) {
  const head = player.getHeadLocation();
  const toward = sub(bodyCenter(target), head);
  const dist = length(toward);
  const power = Math.min(2.8, (dist - 1.5) * 0.45);
  knockback(player, toward, power, 0.25);
  sound(player.dimension, "item.trident.riptide_1", player.location, 0.6);

  let ticks = 0;
  const id = system.runInterval(() => {
    ticks++;
    if (!player.isValid || !target.isValid) return system.clearRun(id);
    particle(player.dimension, "minecraft:basic_crit_particle", player.location);
    const d = length(sub(bodyCenter(target), player.getHeadLocation()));
    if (d <= 2.8 || ticks >= 8) {
      system.clearRun(id);
      if (d <= tier.reach) strike(player, target, item, tier, false);
    }
  }, 1);
}

function doJab(player, directHit) {
  if (!player.isValid || player.getGameMode() === GameMode.Spectator) return;
  const item = getMainhand(player);
  if (!isSpear(item)) return;
  const tier = getTier(item);

  // ตีโดนตรง ๆ: เกมทำดาเมจให้แล้ว เราเพิ่มแค่แทงทะลุ
  if (directHit) {
    provoked.set(player.id, { id: directHit.id, until: system.currentTick + 200 });
    locks.set(player.id, directHit);
    if (!ready(player, "jab")) return;
    startCooldown(player, "jab", tier.jabCd);
    strike(player, directHit, item, tier, true);
    return;
  }

  if (!ready(player, "jab")) return;
  const target = findLockTarget(player);
  if (!target) return;
  const dist = length(sub(bodyCenter(target), player.getHeadLocation()));
  // บล็อกที่มองอยู่ใกล้กว่าเป้า = กำลังขุดบล็อก ไม่แทง
  if (lookedBlockDistance(player) < Math.min(dist, tier.reach) - 0.5) return;

  if (dist <= tier.reach) {
    startCooldown(player, "jab", tier.jabCd);
    strike(player, target, item, tier, false);
  } else if (dist <= tier.reach + LUNGE_EXTRA && player.isOnGround) {
    startCooldown(player, "jab", tier.jabCd + 6);
    lunge(player, target, item, tier);
  }
}

// ---------- ขว้างหอกวิญญาณ (ติดตามเป้า) ----------
function throwSpear(player) {
  const item = getMainhand(player);
  if (!isSpear(item) || !ready(player, "throw")) return;
  const tier = getTier(item);
  const target = findLockTarget(player);
  // ย่อแล้วตีบล็อกที่อยู่ใกล้ ๆ โดยไม่มีเป้า = กำลังขุด
  if (!target && lookedBlockDistance(player) < 3) return;
  startCooldown(player, "throw", THROW_COOLDOWN);
  wearSpear(player, 1);

  const dim = player.dimension;
  const damage = scaleDamage(player, item, tier.throw);
  const fire = enchantLevel(item, "fire_aspect");
  const view = player.getViewDirection();
  let pos = add(player.getHeadLocation(), mul(view, 0.8));
  let dir = target ? normalize(sub(bodyCenter(target), pos)) : view;
  let pierceLeft = tier.pierce;
  const hitIds = new Set();
  const SPEED = 1.8;
  const STEPS = 4;
  let ticks = 0;
  sound(dim, "item.trident.throw", pos);

  const finish = (at) => {
    system.clearRun(id);
    particle(dim, "minecraft:critical_hit_emitter", at);
    sound(dim, "item.trident.hit_ground", at, 0.8);
  };

  const id = system.runInterval(() => {
    try {
      ticks++;
      if (ticks > 30 || !player.isValid) return finish(pos);
      if (target?.isValid && !hitIds.has(target.id)) {
        const want = normalize(sub(bodyCenter(target), pos));
        dir = normalize(add(mul(dir, 0.3), mul(want, 0.7)));
      }
      const step = SPEED / STEPS;
      for (let i = 0; i < STEPS; i++) {
        const hit = dim.getBlockFromRay(pos, dir, { maxDistance: step, includePassableBlocks: false, includeLiquidBlocks: false });
        if (hit) return finish(pos);
        pos = add(pos, mul(dir, step));
        particle(dim, "minecraft:endrod", pos);
        for (const e of dim.getEntities({ location: pos, maxDistance: 1.4 })) {
          if (hitIds.has(e.id) || !canHit(player, e)) continue;
          hitIds.add(e.id);
          if (hurt(player, e, damage, undefined)) {
            knockback(e, dir, 0.6, 0.3);
            if (fire > 0) e.setOnFire(fire * 4, true);
            try {
              e.addEffect("slowness", 40, { amplifier: 1 });
            } catch {}
          }
          particle(dim, "minecraft:critical_hit_emitter", bodyCenter(e));
          sound(dim, "item.trident.hit", pos);
          if (pierceLeft-- <= 0) return finish(pos);
        }
      }
    } catch {
      finish(pos);
    }
  }, 1);
}

// ---------- ฝนหอก ----------
function spearRain(player) {
  const item = getMainhand(player);
  if (!isSpear(item) || !ready(player, "rain")) return;
  const tier = getTier(item);
  const dim = player.dimension;
  const target = findLockTarget(player);

  let center;
  if (target) {
    center = target.location;
  } else {
    const hit = player.getBlockFromViewDirection({ maxDistance: 16, includeLiquidBlocks: true, includePassableBlocks: false });
    center = hit ? add(hit.block.location, { x: 0.5, y: 1, z: 0.5 }) : add(player.location, mul(player.getViewDirection(), 8));
  }
  startCooldown(player, "rain", RAIN_COOLDOWN);
  wearSpear(player, 3);

  const damage = scaleDamage(player, item, tier.rain);
  const enemies = dim
    .getEntities({ location: center, maxDistance: RAIN_RADIUS })
    .filter((e) => canHit(player, e) && (isLockable(player, e) || e.id === target?.id));
  sound(dim, "item.trident.riptide_3", player.location);

  for (let i = 0; i < tier.spears; i++) {
    // แต่ละเล่มเล็งศัตรูก่อน (วนซ้ำได้) ที่เหลือตกสุ่มในวง
    const aim = enemies.length > 0 && i < enemies.length * 2 ? enemies[i % enemies.length] : undefined;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * RAIN_RADIUS;
    const spot = { x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r };
    system.runTimeout(() => dropSpear(player, dim, aim, spot, center.y, damage), i * 2);
  }

  if (tier.lightning && target && length(sub(player.location, center)) > 6) {
    system.runTimeout(() => {
      try {
        if (target.isValid) dim.spawnEntity("minecraft:lightning_bolt", target.location);
      } catch {}
    }, 10);
  }
}

function dropSpear(player, dim, aim, spot, baseY, damage) {
  if (!player.isValid) return;
  const at = aim?.isValid ? aim.location : { x: spot.x, y: baseY, z: spot.z };
  const x = at.x;
  const z = at.z;
  const groundY = groundBelow(dim, { x, y: at.y + 4, z }) ?? at.y;
  let y = groundY + 10;
  const id = system.runInterval(() => {
    y = Math.max(groundY, y - 2.5);
    // ตัวหอกยาว 2.5 บล็อก ปลายชี้ลง
    for (let d = 0; d <= 2.5; d += 0.5) particle(dim, "minecraft:endrod", { x, y: y + d, z });
    if (y > groundY) return;
    system.clearRun(id);
    particle(dim, "minecraft:critical_hit_emitter", { x, y: groundY + 0.3, z });
    sound(dim, "item.trident.hit", { x, y: groundY, z }, 0.7);
    if (!player.isValid) return;
    for (const e of dim.getEntities({ location: { x, y: groundY, z }, maxDistance: 2.5 })) {
      if (!canHit(player, e)) continue;
      const l = e.location;
      if (Math.hypot(l.x - x, l.z - z) > 1.6 || Math.abs(l.y - groundY) > 3) continue;
      if (hurt(player, e, damage, undefined)) {
        try {
          e.addEffect("slowness", 30, { amplifier: 2 });
        } catch {}
      }
    }
  }, 1);
}

// ---------- กระโดดปักหอกกระแทกพื้น ----------
function startSlam(player, tier) {
  if (!ready(player, "slam")) return false;
  const ground = groundBelow(player.dimension, player.location, 40);
  if (ground === undefined || player.location.y - ground < SLAM_MIN_HEIGHT) return false;
  startCooldown(player, "slam", SLAM_COOLDOWN);
  slams.set(player.id, { startY: player.location.y, ticks: 0, tier });
  try {
    player.applyKnockback({ x: 0, z: 0 }, -2.5);
  } catch {}
  // กันดาเมจตกตอนกระแทก
  player.addEffect("resistance", 120, { amplifier: 4, showParticles: false });
  sound(player.dimension, "item.trident.riptide_2", player.location);
  return true;
}

function slamImpact(player, slam) {
  const dim = player.dimension;
  const loc = player.location;
  const height = Math.max(0, slam.startY - loc.y);
  const item = getMainhand(player);
  const base = item && isSpear(item) ? scaleDamage(player, item, slam.tier.damage) : slam.tier.damage;
  const damage = base + Math.min(15, height * 1.2);
  const radius = Math.min(7, 3 + height * 0.3);

  particle(dim, "minecraft:huge_explosion_emitter", loc);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    particle(dim, "minecraft:critical_hit_emitter", { x: loc.x + Math.cos(a) * radius * 0.7, y: loc.y + 0.2, z: loc.z + Math.sin(a) * radius * 0.7 });
  }
  sound(dim, "mace.heavy_smash_ground", loc);
  sound(dim, "random.explode", loc, 0.5);

  for (const e of dim.getEntities({ location: loc, maxDistance: radius })) {
    if (!canHit(player, e)) continue;
    const rel = sub(e.location, loc);
    if (Math.abs(rel.y) > 3) continue;
    const near = 1 - Math.min(1, Math.hypot(rel.x, rel.z) / radius) * 0.5; // ใกล้จุดกระแทกเจ็บกว่า
    if (hurt(player, e, damage * near, item)) knockback(e, rel, 0.9, 0.5);
  }
  wearSpear(player, 2);
  system.runTimeout(() => {
    if (player.isValid) player.removeEffect("resistance");
  }, 5);
}

// ---------- HUD ----------
function cdText(player, skill) {
  const left = getCooldowns(player)[skill] - system.currentTick;
  return left <= 0 ? "§aพร้อม" : `§c${(left / 20).toFixed(1)}s`;
}

function showHud(player, target) {
  const parts = [];
  if (target?.isValid) {
    const dist = length(sub(target.location, player.location)).toFixed(1);
    const name = target.nameTag ? { text: target.nameTag } : { translate: `entity.${target.typeId.replace("minecraft:", "")}.name` };
    parts.push({ text: "§c[เป้า] §f" }, name, { text: ` §7${dist}m   ` });
  } else {
    parts.push({ text: "§7[ไม่มีเป้า]   " });
  }
  parts.push({ text: `§bขว้าง ${cdText(player, "throw")}  §6ฝนหอก ${cdText(player, "rain")}` });
  player.onScreenDisplay.setActionBar({ rawtext: parts });
}

// ---------- ลูปหลัก ----------
system.runInterval(() => {
  const tick = system.currentTick;
  for (const player of world.getPlayers()) {
    // การกระแทกพื้นที่กำลังดิ่งลง
    const slam = slams.get(player.id);
    if (slam) {
      slam.ticks++;
      if (player.isOnGround || slam.ticks > 100) {
        slams.delete(player.id);
        if (player.isOnGround) slamImpact(player, slam);
        else player.removeEffect("resistance");
      } else {
        particle(player.dimension, "minecraft:basic_crit_particle", player.location);
      }
    }

    if (tick % 3 !== 0) continue;
    const item = getMainhand(player);
    if (!isSpear(item)) {
      locks.delete(player.id);
      continue;
    }
    const target = findLockTarget(player);
    if (target && tick % 6 === 0) {
      // เครื่องหมายเป้า (เห็นแค่ผู้เล่นคนนี้)
      try {
        player.spawnParticle("minecraft:villager_angry", add(target.getHeadLocation(), { x: 0, y: 0.8, z: 0 }));
      } catch {}
    }
    if (SHOW_HUD) showHud(player, target);
  }
}, 1);

// ---------- อีเวนต์ ----------
function onAttack(player, hitEntity) {
  const entry = pending.get(player.id);
  if (entry) {
    if (hitEntity) entry.hitEntity = hitEntity;
    return;
  }
  pending.set(player.id, { player, hitEntity });
  // รอ 1 tick เพื่อให้รู้ว่าแตะครั้งนี้ตีโดนมอนตรง ๆ หรือไม่
  system.run(() => {
    const e = pending.get(player.id);
    pending.delete(player.id);
    if (!e || !e.player.isValid) return;
    const p = e.player;
    const direct = e.hitEntity?.isValid ? e.hitEntity : undefined;
    const item = getMainhand(p);
    if (!isSpear(item)) return;

    // กลางอากาศสูงพอ = ปักหอกกระแทกพื้น
    if (!direct && !p.isOnGround && !p.isFlying && !p.isGliding && !slams.has(p.id)) {
      if (startSlam(p, getTier(item))) return;
    }
    // ย่อ + แตะตี = ขว้างหอกวิญญาณ
    if (p.isSneaking && !direct) return throwSpear(p);
    doJab(p, direct);
  });
}

// แตะตี (แม้ไม่โดนอะไร)
world.afterEvents.playerSwingStart.subscribe((ev) => {
  if (ev.swingSource !== EntitySwingSource.Attack) return;
  if (!isSpear(ev.heldItemStack)) return;
  onAttack(ev.player, undefined);
});

// ตีโดนมอนตรง ๆ
world.afterEvents.entityHitEntity.subscribe((ev) => {
  const player = ev.damagingEntity;
  if (player.typeId !== "minecraft:player") return;
  if (!isSpear(getMainhand(player))) return;
  onAttack(player, ev.hitEntity);
});

// กดใช้ค้าง (ชาร์จหอก) แล้วปล่อย = ฝนหอก
world.afterEvents.itemStartUse.subscribe((ev) => {
  if (isSpear(ev.itemStack)) useStart.set(ev.source.id, system.currentTick);
});

world.afterEvents.itemStopUse.subscribe((ev) => {
  const start = useStart.get(ev.source.id);
  useStart.delete(ev.source.id);
  if (start === undefined) return;
  if (system.currentTick - start >= RAIN_CHARGE_TICKS) spearRain(ev.source);
});

// ทางเลือก: ย่อ + กดกระโดด = ฝนหอก (สะดวกบนมือถือ)
world.afterEvents.playerButtonInput?.subscribe((ev) => {
  if (ev.button !== "Jump" || ev.newButtonState !== "Pressed") return;
  const player = ev.player;
  if (!player.isSneaking || !isSpear(getMainhand(player))) return;
  spearRain(player);
});

world.afterEvents.playerLeave.subscribe((ev) => {
  for (const map of [locks, provoked, cooldowns, pending, useStart, slams]) map.delete(ev.playerId);
});

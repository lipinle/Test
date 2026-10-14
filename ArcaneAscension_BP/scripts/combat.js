import { world, system, EntityDamageCause, EquipmentSlot, TextPrimitive } from "@minecraft/server";
import { DAMAGE_TEXT_MAX } from "./config.js";
import { getData, worldSettings } from "./data.js";
import { fx, COL, sound } from "./fx.js";
import { V, alive, rand, chance, heal, getMainhand, centerOf, safe, playersNear } from "./util.js";

// ---------- ตารางสถานะพิเศษ (โมดูลอื่นเติมข้อมูล) ----------
export const frozen = new Map(); // entity.id -> { entity, loc, rot, acc, attacker } (หยุดเวลา)
export const shielded = new Set(); // entity.id ที่มีโล่ (ไททันระยะ 2)
export const vulnerable = new Map(); // entity.id -> ตัวคูณดาเมจที่ได้รับ
const armorCache = new Map(); // player.id -> { archmage, voidplate }

const NEVER = new Set([
  "minecraft:item", "minecraft:xp_orb", "minecraft:armor_stand", "minecraft:painting", "minecraft:leash_knot",
  "minecraft:lightning_bolt", "minecraft:npc", "minecraft:agent", "minecraft:tripod_camera",
  "arc:rift_portal", "arc:damage_text",
]);
const FRIENDLY = new Set([
  "minecraft:villager", "minecraft:villager_v2", "minecraft:wandering_trader", "minecraft:iron_golem",
  "minecraft:snow_golem", "minecraft:allay", "minecraft:copper_golem", "arc:spirit_wolf",
]);

function isTamed(e) {
  try {
    if (e.hasComponent("minecraft:is_tamed")) return true;
    return !!e.getComponent("minecraft:tameable")?.isTamed;
  } catch {
    return false;
  }
}

/** พวกเดียวกับผู้เล่น (ใช้กับคาถารักษา) */
export function isAlly(e) {
  if (!alive(e)) return false;
  return e.typeId === "minecraft:player" || e.typeId === "arc:spirit_wolf" || isTamed(e);
}

/** attacker ทำร้าย target ได้ไหม (กันโดนพวกเดียวกัน / ชาวบ้าน / สัตว์เลี้ยง) */
export function canHit(attacker, target) {
  if (!alive(target) || NEVER.has(target.typeId)) return false;
  let aId;
  let aType;
  try {
    aId = attacker?.id;
    aType = attacker?.typeId;
  } catch {
    attacker = undefined;
  }
  if (aId && target.id === aId) return false;
  if (!target.hasComponent("minecraft:health")) return false;
  if (!aType || aType === "minecraft:player" || aType === "arc:spirit_wolf") {
    if (target.typeId === "minecraft:player") return worldSettings().pvp;
    if (FRIENDLY.has(target.typeId)) return false;
    if (isTamed(target)) return false;
    return true;
  }
  // ผู้โจมตีเป็นมอนสเตอร์/บอส: โดนเฉพาะผู้เล่นและพันธมิตร
  if (target.typeId === "minecraft:player") {
    const gm = safe(() => target.getGameMode());
    return gm !== "Creative" && gm !== "Spectator";
  }
  return target.typeId === "arc:spirit_wolf" || target.typeId === "minecraft:iron_golem" || isTamed(target);
}

export function spellDamage(target, amount, attacker, cause = EntityDamageCause.magic) {
  if (!alive(target) || amount <= 0) return false;
  try {
    if (attacker && alive(attacker)) return target.applyDamage(amount, { cause, damagingEntity: attacker });
    return target.applyDamage(amount, { cause });
  } catch {
    return false;
  }
}

/** ศัตรูในรัศมีที่ attacker ทำร้ายได้ */
export function enemiesNear(attacker, dim, loc, radius, maxCount = 64) {
  let list = [];
  try {
    list = dim.getEntities({ location: loc, maxDistance: radius, excludeTypes: [...NEVER] });
  } catch {
    return [];
  }
  const out = [];
  for (const e of list) {
    if (out.length >= maxCount) break;
    if (canHit(attacker, e)) out.push(e);
  }
  return out;
}

/** ดาเมจวงกว้างแบบลดตามระยะ (ขอบวงได้ minFrac ของดาเมจ) */
export function aoe(attacker, dim, loc, radius, damage, opts = {}) {
  const hit = [];
  for (const e of enemiesNear(attacker, dim, loc, radius + 1)) {
    const d = V.dist(centerOf(e), loc);
    if (d > radius + 0.8) continue;
    const k = 1 - (1 - (opts.minFrac ?? 0.5)) * Math.min(1, d / radius);
    if (spellDamage(e, damage * k, attacker, opts.cause ?? EntityDamageCause.magic)) {
      hit.push(e);
      if (opts.fire) safe(() => e.setOnFire(opts.fire, true));
      if (opts.knock) {
        const dir = V.norm({ x: e.location.x - loc.x, y: 0, z: e.location.z - loc.z });
        safe(() => e.applyKnockback({ x: dir.x * opts.knock, z: dir.z * opts.knock }, opts.lift ?? 0.4));
      }
      if (opts.effect) safe(() => e.addEffect(opts.effect[0], opts.effect[1], { amplifier: opts.effect[2] ?? 0 }));
    }
  }
  return hit;
}

// ---------- ชุดเกราะ ----------
export function refreshArmor(player) {
  const eq = player.getComponent("minecraft:equippable");
  const sets = { archmage: 0, voidplate: 0 };
  if (eq) {
    for (const slot of [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet]) {
      const id = eq.getEquipment(slot)?.typeId;
      if (!id) continue;
      if (id.startsWith("arc:archmage_")) sets.archmage++;
      else if (id.startsWith("arc:voidplate_")) sets.voidplate++;
    }
  }
  armorCache.set(player.id, sets);
  return sets;
}

export function armorOf(player) {
  return armorCache.get(player.id) ?? refreshArmor(player);
}

// ---------- รูน ----------
export function readRunes(item) {
  if (!item) return [];
  const raw = safe(() => item.getDynamicProperty("arc:runes"));
  return typeof raw === "string" && raw.length ? raw.split(",") : [];
}

function applyRunes(player, target, damage) {
  const item = getMainhand(player);
  const runes = readRunes(item);
  if (!runes.length || !alive(target)) return;
  const dim = target.dimension;
  const c = centerOf(target);
  for (const r of runes) {
    if (r === "fire") {
      safe(() => target.setOnFire(4, true));
      spellDamage(target, 2, player, EntityDamageCause.fire);
      fx.burst(dim, c, COL.fire, 8, 3);
    } else if (r === "frost") {
      safe(() => target.addEffect("slowness", 60, { amplifier: 2, showParticles: false }));
      fx.shards(dim, c, COL.frost, 8, 3);
    } else if (r === "storm" && chance(0.2)) {
      fx.bolt(dim, V.up(target.location, 9), c, COL.storm, 0.8);
      sound(dim, "ambient.weather.lightning.impact", c, 0.6, 1.4);
      spellDamage(target, 5, player, EntityDamageCause.lightning);
      let n = 0;
      for (const e of enemiesNear(player, dim, c, 4)) {
        if (e.id === target.id || n >= 2) continue;
        n++;
        fx.bolt(dim, c, centerOf(e), COL.storm, 0.4);
        spellDamage(e, 4, player, EntityDamageCause.lightning);
      }
    } else if (r === "leech") {
      const got = heal(player, damage * 0.2);
      if (got > 0.1) fx.line(dim, c, V.up(player.location, 1), COL.red, 0.6, 0.15, 0.3);
    }
  }
}

// ---------- ตัวเลขดาเมจลอย ----------
let usePrimitive = true;
const texts = [];

function causeColor(cause) {
  switch (cause) {
    case EntityDamageCause.magic: return "§d";
    case EntityDamageCause.fire:
    case EntityDamageCause.fireTick:
    case EntityDamageCause.lava: return "§6";
    case EntityDamageCause.lightning: return "§e";
    case EntityDamageCause.freezing: return "§b";
    case EntityDamageCause.entityAttack: return "§f";
    case EntityDamageCause.wither: return "§8";
    default: return "§7";
  }
}

function removeText(t) {
  if (t.shape) safe(() => t.shape.remove());
  if (t.ent && alive(t.ent)) safe(() => t.ent.remove());
}

export function showNumber(dim, loc, text) {
  const viewers = playersNear(dim, loc, 32, true).filter((p) => getData(p).set.dmg);
  if (!viewers.length) return;
  while (texts.length >= DAMAGE_TEXT_MAX) removeText(texts.shift());
  const base = { x: loc.x + rand(-0.35, 0.35), y: loc.y, z: loc.z + rand(-0.35, 0.35) };
  if (usePrimitive) {
    try {
      const t = new TextPrimitive({ ...base, dimension: dim }, text);
      t.backgroundColorOverride = { red: 0, green: 0, blue: 0, alpha: 0 };
      t.depthTest = false;
      t.maximumRenderDistance = 40;
      t.visibleTo = viewers;
      world.primitiveShapesManager.addText(t, dim);
      safe(() => (t.timeLeft = 1.2));
      texts.push({ shape: t, base, dim, age: 0 });
      return;
    } catch (err) {
      usePrimitive = false;
      console.warn(`[Arcane] TextPrimitive unavailable, using entity holograms: ${err}`);
    }
  }
  try {
    const e = dim.spawnEntity("arc:damage_text", base);
    e.nameTag = text;
    texts.push({ ent: e, base, dim, age: 0 });
  } catch {}
}

function tickTexts() {
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.age++;
    if (t.age > 22) {
      removeText(t);
      texts.splice(i, 1);
      continue;
    }
    const y = t.base.y + Math.min(t.age, 14) * 0.05;
    const loc = { x: t.base.x, y, z: t.base.z };
    if (t.shape) safe(() => t.shape.setLocation({ ...loc, dimension: t.dim }));
    else if (t.ent && alive(t.ent)) safe(() => t.ent.teleport(loc));
  }
}

export function clearTexts() {
  while (texts.length) removeText(texts.pop());
  safe(() => {
    for (const d of ["overworld", "nether", "the_end"]) {
      for (const e of world.getDimension(d).getEntities({ type: "arc:damage_text" })) e.remove();
    }
  });
}

// ---------- ลงทะเบียน event ----------
let shieldFxTick = 0;

export function initCombat() {
  world.beforeEvents.entityHurt.subscribe((ev) => {
    const t = ev.hurtEntity;
    const fz = frozen.get(t.id);
    if (fz) {
      fz.acc += ev.damage;
      if (ev.damageSource.damagingEntity) fz.attacker = ev.damageSource.damagingEntity;
      ev.cancel = true;
      return;
    }
    if (shielded.has(t.id) && ev.damageSource.cause !== EntityDamageCause.override && ev.damageSource.cause !== EntityDamageCause.selfDestruct) {
      ev.cancel = true;
      if (system.currentTick - shieldFxTick > 8) {
        shieldFxTick = system.currentTick;
        system.run(() => {
          if (!alive(t)) return;
          fx.implode(t.dimension, centerOf(t), COL.void, 3, 16, 0.25);
          sound(t.dimension, "random.anvil_land", t.location, 0.5, 1.6);
        });
      }
      return;
    }
    const mult = vulnerable.get(t.id);
    if (mult) ev.damage *= mult;
    if (t.typeId === "minecraft:player") {
      const sets = armorCache.get(t.id);
      if (sets?.voidplate) {
        if (sets.voidplate >= 4 && ev.damageSource.cause === EntityDamageCause.fall) {
          ev.cancel = true;
          return;
        }
        ev.damage *= 1 - 0.05 * sets.voidplate;
      }
    }
  });

  world.afterEvents.entityHurt.subscribe((ev) => {
    const t = ev.hurtEntity;
    if (!alive(t)) return;
    const src = ev.damageSource;
    if (t.typeId !== "minecraft:player" && ev.damage > 0.05) {
      const big = ev.damage >= 15;
      const txt = `${causeColor(src.cause)}${big ? "§l" : ""}${Math.round(ev.damage * 10) / 10}`;
      showNumber(t.dimension, V.up(t.location, safe(() => t.getAABB().extent.y * 2) ?? 1.8), txt);
    }
    if (src.cause === EntityDamageCause.entityAttack && src.damagingEntity?.typeId === "minecraft:player") {
      applyRunes(src.damagingEntity, t, ev.damage);
    }
  });

  // ป้ายตัวเลขแบบ entity ที่ค้างจากการเซฟเกม -> ลบทิ้ง
  world.afterEvents.entityLoad.subscribe(({ entity }) => {
    if (entity.typeId === "arc:damage_text" && !texts.some((t) => t.ent && t.ent.id === entity.id)) system.run(() => alive(entity) && safe(() => entity.remove()));
  });
  system.runInterval(tickTexts, 1);
}


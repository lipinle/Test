// ความฉลาดของมอน: พุ่งกระโจน, กระโดดขึ้นหาคนต่อเสา, ถอยหนีแล้วยิง, หลบข้าง,
// เรียกพวกมารุม, ล่าเป็นฝูง, ฮึดสู้ตอนเลือดน้อย

import { EntityDamageCause, Player, system, world } from "@minecraft/server";
import { AI_RANGE, ALERTABLE, KITERS, LUNGERS, NIGHT_ONLY } from "./config.js";
import { MOB_TAG } from "./gear.js";
import { chance, isNight, isSurvival } from "./util.js";

/** มอน id -> tick ที่ใช้ท่าได้อีกครั้ง */
const moveCooldown = new Map();
/** ผู้เล่น id -> tick ที่เรียกพวกได้อีกครั้ง */
const alertCooldown = new Map();
/** มอน id -> tick ที่โดนดาเมจปลอมจากการเรียกพวก (ไม่นับเป็นการโดนตีจริง) */
const alertedAt = new Map();

const LUNGE_COOLDOWN = 50;
const JUMP_COOLDOWN = 40;
const KITE_COOLDOWN = 40;
const DODGE_COOLDOWN = 30;
const ALERT_COOLDOWN = 40;
const MAX_ALERTED = 8;
const RALLY_TAG = "smartmobs_rallied";

function ready(id, cooldown) {
  const now = system.currentTick;
  if ((moveCooldown.get(id) ?? 0) > now) return false;
  moveCooldown.set(id, now + cooldown);
  return true;
}

function sleeping(typeId) {
  return NIGHT_ONLY.has(typeId) && !isNight();
}

function onGround(entity) {
  return entity.isOnGround !== false;
}

function impulse(entity, x, y, z) {
  try {
    entity.applyImpulse({ x, y, z });
  } catch {
    // ไม่เป็นไร
  }
}

/** มอนหันหน้าเข้าหาเป้าหมายไหม (ใช้แทนการเช็กว่ากำลังไล่ผู้เล่นอยู่) */
function facing(mob, dx, dz, dist) {
  const v = mob.getViewDirection();
  const len = Math.hypot(v.x, v.z);
  if (len < 0.01 || dist < 0.01) return false;
  return (v.x * dx + v.z * dz) / (len * dist) > 0.75;
}

// ---------------------------------------------------------------------------
// ทุก 0.5 วินาที: ท่าเคลื่อนไหวรอบตัวผู้เล่น
// ---------------------------------------------------------------------------

function moveNear(player, mob, ai) {
  const p = player.location;
  const m = mob.location;
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const dz = p.z - m.z;
  const dist = Math.hypot(dx, dz);
  const type = mob.typeId;

  if (LUNGERS.has(type) && !sleeping(type)) {
    // ผู้เล่นต่อเสาหนีอยู่เหนือหัว: กระโดดสูงขึ้นไปตี
    if (ai.jumpUp && dist < 2.5 && dy > 1.8 && dy < 4.5 && onGround(mob) && ready(mob.id, JUMP_COOLDOWN)) {
      const f = dist > 0.01 ? 0.15 / dist : 0;
      impulse(mob, dx * f, 0.7, dz * f);
      return;
    }
    // พุ่งกระโจนเข้าใส่
    if (
      ai.lunge > 0 &&
      dist > 2.5 &&
      dist < 7 &&
      Math.abs(dy) < 1.5 &&
      onGround(mob) &&
      facing(mob, dx, dz, dist) &&
      chance(ai.lunge) &&
      ready(mob.id, LUNGE_COOLDOWN)
    ) {
      const f = ai.lungePower / dist;
      impulse(mob, dx * f, 0.3, dz * f);
    }
    return;
  }

  // มอนยิงไกล: ผู้เล่นเข้ามาใกล้ -> ถอยหลังพร้อมเบี่ยงข้าง แล้วค่อยยิงต่อ
  if (KITERS.has(type) && ai.kite > 0 && dist < 5 && dist > 0.01 && onGround(mob) && facing(mob, dx, dz, dist)) {
    if (chance(ai.kite) && ready(mob.id, KITE_COOLDOWN)) {
      const side = chance(0.5) ? 1 : -1;
      const bx = -dx / dist;
      const bz = -dz / dist;
      impulse(mob, bx * 0.45 + -bz * side * 0.3, 0.2, bz * 0.45 + bx * side * 0.3);
    }
  }
}

export function aiTick(tier) {
  const ai = tier.ai;
  if (!ai.lunge && !ai.kite && !ai.jumpUp) return;
  for (const player of world.getAllPlayers()) {
    if (!isSurvival(player)) continue;
    let mobs;
    try {
      mobs = player.dimension.getEntities({ location: player.location, maxDistance: AI_RANGE, tags: [MOB_TAG] });
    } catch {
      continue;
    }
    for (const mob of mobs) {
      try {
        moveNear(player, mob, ai);
      } catch {
        // มอนหายไประหว่างทาง
      }
    }
  }
  pruneMaps();
}

function pruneMaps() {
  const now = system.currentTick;
  if (now % 600 !== 0) return;
  for (const map of [moveCooldown, alertCooldown]) {
    for (const [id, t] of map) if (t < now) map.delete(id);
  }
  for (const [id, t] of alertedAt) if (now - t > 20) alertedAt.delete(id);
}

// ---------------------------------------------------------------------------
// เรียกพวก
// ---------------------------------------------------------------------------

/** ให้มอนรอบ ๆ center หันมาเล่นงาน player — ใช้ดาเมจ 1 หน่วยจากผู้เล่นเพื่อให้มอนล็อกเป้า */
function alertAround(dimension, center, player, radius) {
  const now = system.currentTick;
  if ((alertCooldown.get(player.id) ?? 0) > now) return;
  alertCooldown.set(player.id, now + ALERT_COOLDOWN);

  const night = isNight();
  const p = player.location;
  let mobs;
  try {
    mobs = dimension.getEntities({ location: center, maxDistance: radius, tags: [MOB_TAG] });
  } catch {
    return;
  }
  let count = 0;
  for (const mob of mobs) {
    if (count >= MAX_ALERTED) break;
    try {
      if (!ALERTABLE.has(mob.typeId)) continue;
      if (NIGHT_ONLY.has(mob.typeId) && !night) continue;
      const m = mob.location;
      if (Math.hypot(p.x - m.x, p.y - m.y, p.z - m.z) < 4) continue; // อยู่ในวงต่อสู้แล้ว
      const hp = mob.getComponent("minecraft:health");
      if (!hp || hp.currentValue <= 2) continue;
      alertedAt.set(mob.id, now);
      mob.applyDamage(1, { cause: EntityDamageCause.entityAttack, damagingEntity: player });
      count++;
    } catch {
      // ไม่เป็นไร
    }
  }
}

// ---------------------------------------------------------------------------
// เมื่อมีการโจมตี
// ---------------------------------------------------------------------------

function sidestep(mob, attacker) {
  if (!onGround(mob) || !ready(mob.id, DODGE_COOLDOWN)) return;
  const a = attacker.location;
  const m = mob.location;
  const dx = m.x - a.x;
  const dz = m.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return;
  const side = chance(0.5) ? 1 : -1;
  impulse(mob, (-dz / d) * side * 0.5, 0.2, (dx / d) * side * 0.5);
}

function secondWind(mob) {
  if (mob.hasTag(RALLY_TAG)) return;
  const hp = mob.getComponent("minecraft:health");
  if (!hp || hp.currentValue <= 0 || hp.currentValue / hp.effectiveMax > 0.3) return;
  mob.addTag(RALLY_TAG);
  mob.addEffect("regeneration", 100, { amplifier: 1, showParticles: true });
  mob.addEffect("speed", 80, { amplifier: 1, showParticles: false });
}

/** @param {import("@minecraft/server").EntityHurtAfterEvent} ev */
export function onHurt(ev, tier) {
  const ai = tier.ai;
  const victim = ev.hurtEntity;
  const attacker = ev.damageSource.damagingEntity;
  if (!attacker || !victim.isValid || !attacker.isValid) return;

  // ผู้เล่นตีมอน
  if (attacker instanceof Player && victim.hasTag(MOB_TAG)) {
    const t = alertedAt.get(victim.id);
    if (t !== undefined && system.currentTick - t <= 2) return; // ดาเมจจากการเรียกพวกเอง
    if (!isSurvival(attacker)) return;
    if (ai.dodge > 0 && ev.damageSource.cause === EntityDamageCause.entityAttack && chance(ai.dodge)) {
      sidestep(victim, attacker);
    }
    if (ai.secondWind) secondWind(victim);
    if (ai.alert > 0) alertAround(victim.dimension, victim.location, attacker, ai.alert);
    return;
  }

  // มอนตีโดนผู้เล่น: ล่าเป็นฝูง
  if (victim instanceof Player && attacker.hasTag(MOB_TAG) && ai.packHunt && isSurvival(victim)) {
    alertAround(victim.dimension, victim.location, victim, Math.max(8, ai.alert / 2));
  }
}

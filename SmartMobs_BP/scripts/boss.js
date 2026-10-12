// บอส: เกิดเองตอนกลางคืน (หรือเรียกด้วยกะโหลกต้องสาป), เลือดเยอะ, ท่าพิเศษ, ลูกน้อง, ดรอปของหายาก
//
// เลือดบอสเก็บใน Dynamic Property (smartmobs:hp) แยกจากเลือดจริงของมอน
// ทุกครั้งที่โดนตี สคริปต์จะหักเลือดบอสแล้วเติมเลือดจริงให้เต็ม เมื่อเลือดบอสหมดจึงตายจริง

import { EntityDamageCause, ItemStack, Player, system, world } from "@minecraft/server";
import {
  BOSS_COMMON_LOOT,
  BOSS_HP_PER_TIER,
  BOSS_LOOT_PER_TIER,
  BOSS_MAX_ALIVE,
  BOSS_MIN_TIER,
  BOSS_NATURAL_COOLDOWN_DAYS,
  BOSS_SPAWN_CHANCE,
  BOSS_SPAWN_CHANCE_PER_TIER,
  BOSSES,
  LEGENDARY_INFO,
  TIERS,
} from "./config.js";
import { MOB_TAG, outfitBoss } from "./gear.js";
import { currentTierIndex } from "./tier.js";
import { chance, isNight, isSurvival, pick, randInt } from "./util.js";

export const BOSS_TAG = "smartmobs_boss";
export const MINION_TAG = "smartmobs_minion";
const ENRAGED_TAG = "smartmobs_enraged";
const P_TYPE = "smartmobs:boss";
const P_HP = "smartmobs:hp";
const P_MAX = "smartmobs:maxHp";
const P_TIER = "smartmobs:bossTier";
const LAST_NATURAL_KEY = "smartmobs:lastBossTime";

/** มอนธรรมชาติ -> รายชื่อบอสที่อาจกลายเป็น */
const BOSS_FROM = new Map();
for (const [id, def] of Object.entries(BOSSES)) {
  for (const t of def.from) BOSS_FROM.set(t, [...(BOSS_FROM.get(t) ?? []), id]);
}

/** บอส id -> ข้อมูลล่าสุด (ใช้ตอนตาย เพราะอ่านจากมอนที่ตายแล้วไม่ได้แน่นอน) */
const lastSeen = new Map();
/** บอส id -> { name, tick } ผู้เล่นที่ตีล่าสุด */
const lastPlayerHit = new Map();
/** บอส id -> tick ที่โดนตีล่าสุด */
const lastHurt = new Map();
/** `${id}:${ท่า}` -> tick ที่ใช้ได้อีกครั้ง */
const cooldowns = new Map();

// ---------------------------------------------------------------------------
// ข้อมูลบอส
// ---------------------------------------------------------------------------

export function bossId(entity) {
  try {
    const t = entity.getDynamicProperty(P_TYPE);
    return typeof t === "string" && BOSSES[t] ? t : undefined;
  } catch {
    return undefined;
  }
}

const num = (entity, key, def = 0) => {
  const v = entity.getDynamicProperty(key);
  return typeof v === "number" ? v : def;
};

function hpBar(hp, max) {
  const n = 20;
  const filled = Math.max(0, Math.min(n, Math.ceil((hp / max) * n)));
  return `§c${"|".repeat(filled)}§8${"|".repeat(n - filled)} §f${Math.ceil(hp)}/${max}`;
}

function bossTitle(entity, id) {
  const def = BOSSES[id];
  const rage = entity.hasTag(ENRAGED_TAG) ? " §c(คลั่ง)" : "";
  return `§l§4☠ ${def.name}§r${rage}\n${hpBar(num(entity, P_HP), num(entity, P_MAX, 1))}`;
}

function updateName(entity, id) {
  try {
    entity.nameTag = bossTitle(entity, id);
  } catch {
    // ไม่เป็นไร
  }
}

function playersNear(dimension, loc, radius, survivalOnly = true) {
  return world.getAllPlayers().filter((p) => {
    if (p.dimension.id !== dimension.id) return false;
    if (survivalOnly && !isSurvival(p)) return false;
    const l = p.location;
    return Math.hypot(l.x - loc.x, l.y - loc.y, l.z - loc.z) <= radius;
  });
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function fx(dimension, particle, loc) {
  try {
    dimension.spawnParticle(particle, loc);
  } catch {
    // ไม่เป็นไร
  }
}

function sound(dimension, id, loc, volume = 1) {
  try {
    dimension.playSound(id, loc, { volume });
  } catch {
    // ไม่เป็นไร
  }
}

// ---------------------------------------------------------------------------
// สร้างบอส
// ---------------------------------------------------------------------------

export function makeBoss(dimension, location, id, tierIndex) {
  const def = BOSSES[id];
  let boss;
  try {
    // ซอมบี้อาจเกิดเป็นเด็ก จึงบังคับให้เป็นตัวโต (อีเวนต์นี้มีเฉพาะซอมบี้)
    const options = def.base === "minecraft:zombie" ? { initialPersistence: true, spawnEvent: "minecraft:as_adult" } : { initialPersistence: true };
    boss = dimension.spawnEntity(def.base, location, options);
  } catch {
    boss = dimension.spawnEntity(def.base, location);
  }
  boss.addTag(BOSS_TAG);
  boss.addTag(MOB_TAG);
  outfitBoss(boss, Math.min(TIERS.length - 1, tierIndex + 1));

  const max = Math.round(def.hp * (1 + BOSS_HP_PER_TIER * tierIndex));
  boss.setDynamicProperty(P_TYPE, id);
  boss.setDynamicProperty(P_HP, max);
  boss.setDynamicProperty(P_MAX, max);
  boss.setDynamicProperty(P_TIER, tierIndex);

  const forever = 20000000;
  const effects = [
    ["health_boost", 9],
    ["fire_resistance", 0],
    ["strength", Math.floor(tierIndex / 3)],
  ];
  for (const [effect, amp] of effects) {
    try {
      boss.addEffect(effect, forever, { amplifier: amp, showParticles: false });
    } catch {
      // ไม่เป็นไร
    }
  }
  try {
    boss.getComponent("minecraft:health")?.resetToMaxValue();
  } catch {
    // ไม่เป็นไร
  }
  updateName(boss, id);
  remember(boss, id);

  fx(dimension, "minecraft:huge_explosion_emitter", location);
  sound(dimension, "mob.wither.spawn", location, 2);
  for (const p of playersNear(dimension, location, 64, false)) {
    p.sendMessage(`§4⚠ §c${def.name} §4ปรากฏตัวขึ้นใกล้ ๆ! §7(${Math.round(dist(p.location, location))} บล็อก)`);
    try {
      p.onScreenDisplay.setTitle(`§4${def.name}`, { subtitle: "§cบอสปรากฏตัว!", fadeInDuration: 10, stayDuration: 50, fadeOutDuration: 20 });
    } catch {
      // ไม่เป็นไร
    }
  }
  return boss;
}

function remember(boss, id) {
  lastSeen.set(boss.id, { id, dim: boss.dimension, loc: boss.location, tier: num(boss, P_TIER) });
}

/** มอนที่เพิ่งเกิดตามธรรมชาติ: ลุ้นกลายเป็นบอส — คืน true ถ้ากลายแล้ว (ตัวเดิมถูกลบ) */
export function maybeNaturalBoss(entity, cause) {
  if (cause !== "Spawned") return false;
  const options = BOSS_FROM.get(entity.typeId);
  if (!options) return false;
  const tier = currentTierIndex();
  if (tier < BOSS_MIN_TIER) return false;
  if (!chance(BOSS_SPAWN_CHANCE + BOSS_SPAWN_CHANCE_PER_TIER * tier)) return false;

  const dimension = entity.dimension;
  if (dimension.id === "minecraft:overworld" && !isNight()) return false;
  const now = world.getAbsoluteTime();
  const last = world.getDynamicProperty(LAST_NATURAL_KEY);
  if (typeof last === "number" && now - last < BOSS_NATURAL_COOLDOWN_DAYS * 24000 && now >= last) return false;

  const loc = entity.location;
  const player = playersNear(dimension, loc, 48)[0];
  if (!player) return false;
  if (dimension.getEntities({ location: player.location, maxDistance: 128, tags: [BOSS_TAG] }).length >= BOSS_MAX_ALIVE) {
    return false;
  }

  entity.remove();
  makeBoss(dimension, loc, pick(options), tier);
  world.setDynamicProperty(LAST_NATURAL_KEY, now);
  return true;
}

/** เรียกบอสข้างหน้าผู้เล่น (กะโหลกต้องสาป / คำสั่ง) */
export function summonBossNear(player, id) {
  const bossKey = id && BOSSES[id] ? id : pick(Object.keys(BOSSES));
  const dim = player.dimension;
  const p = player.location;
  const v = player.getViewDirection();
  const len = Math.hypot(v.x, v.z) || 1;
  let spot = { x: p.x, y: p.y, z: p.z };
  for (let d = 5; d >= 2; d--) {
    const c = { x: p.x + (v.x / len) * d, y: p.y, z: p.z + (v.z / len) * d };
    try {
      const b = dim.getBlock(c);
      if (b?.isAir && b.above()?.isAir) {
        spot = { x: Math.floor(c.x) + 0.5, y: Math.floor(c.y), z: Math.floor(c.z) + 0.5 };
        break;
      }
    } catch {
      // ไม่เป็นไร
    }
  }
  return makeBoss(dim, spot, bossKey, currentTierIndex());
}

// ---------------------------------------------------------------------------
// โดนตี / ตีโดน
// ---------------------------------------------------------------------------

function kill(boss, attacker) {
  try {
    boss.applyDamage(100000, attacker?.isValid ? { cause: EntityDamageCause.entityAttack, damagingEntity: attacker } : { cause: EntityDamageCause.override });
  } catch {
    try {
      boss.kill();
    } catch {
      // ไม่เป็นไร
    }
  }
}

function enrage(boss, id) {
  if (boss.hasTag(ENRAGED_TAG)) return;
  boss.addTag(ENRAGED_TAG);
  const tier = num(boss, P_TIER);
  try {
    boss.addEffect("speed", 20000000, { amplifier: 0, showParticles: false });
    boss.addEffect("strength", 20000000, { amplifier: Math.floor(tier / 3) + 1, showParticles: false });
  } catch {
    // ไม่เป็นไร
  }
  fx(boss.dimension, "minecraft:villager_angry", { ...boss.location, y: boss.location.y + 2 });
  sound(boss.dimension, "mob.enderdragon.growl", boss.location, 1.5);
  for (const p of playersNear(boss.dimension, boss.location, 32, false)) {
    p.sendMessage(`§c${BOSSES[id].name} คลั่งแล้ว! เร็วขึ้นและตีแรงขึ้น`);
  }
}

/** @param {import("@minecraft/server").EntityHurtAfterEvent} ev */
export function onBossHurt(ev) {
  const victim = ev.hurtEntity;
  const attacker = ev.damageSource.damagingEntity;

  // บอสตีโดนผู้เล่น -> เอฟเฟกต์ประจำตัวบอส
  if (victim instanceof Player && attacker?.isValid && attacker.hasTag(BOSS_TAG)) {
    const id = bossId(attacker);
    const hit = id && BOSSES[id].onHit;
    if (hit) {
      try {
        victim.addEffect(hit.id, hit.ticks, { amplifier: hit.amp });
      } catch {
        // ไม่เป็นไร
      }
    }
    return;
  }

  if (!victim.isValid || !victim.hasTag(BOSS_TAG)) return;
  const id = bossId(victim);
  if (!id) return;
  const hp = num(victim, P_HP);
  if (hp <= 0) return; // กำลังตาย

  const tick = system.currentTick;
  lastHurt.set(victim.id, tick);
  if (attacker instanceof Player) lastPlayerHit.set(victim.id, { name: attacker.name, tick });
  remember(victim, id);

  const left = Math.max(0, hp - ev.damage);
  victim.setDynamicProperty(P_HP, left);
  if (left <= 0) {
    updateName(victim, id);
    kill(victim, attacker);
    return;
  }
  const health = victim.getComponent("minecraft:health");
  if (health && health.currentValue > 0) health.resetToMaxValue();
  if (left / num(victim, P_MAX, 1) < 0.5) enrage(victim, id);
  updateName(victim, id);
}

// ---------------------------------------------------------------------------
// ตาย -> ดรอปของ
// ---------------------------------------------------------------------------

function spawnLoot(dimension, loc, id, tier) {
  const mult = 1 + BOSS_LOOT_PER_TIER * tier;
  const rare = [];
  const stacks = [];
  for (const l of BOSSES[id].loot) {
    if (!chance(l.chance * mult)) continue;
    try {
      const s = new ItemStack(l.item, 1);
      const info = LEGENDARY_INFO[l.item];
      if (info) s.setLore(info.lore);
      stacks.push(s);
      rare.push(info?.name ?? l.item);
    } catch {
      // ไอเท็มโหลดไม่ขึ้น
    }
  }
  for (const l of BOSS_COMMON_LOOT) {
    if (!chance(l.chance)) continue;
    try {
      const s = new ItemStack(l.item, randInt(l.min, l.max));
      const info = LEGENDARY_INFO[l.item];
      if (info) s.setLore(info.lore);
      stacks.push(s);
    } catch {
      // ไม่เป็นไร
    }
  }
  const at = { x: loc.x, y: loc.y + 0.5, z: loc.z };
  for (const s of stacks) {
    try {
      dimension.spawnItem(s, at);
    } catch {
      // ไม่เป็นไร
    }
  }
  try {
    for (let i = 0; i < 12 + tier * 3; i++) dimension.spawnEntity("minecraft:xp_orb", at);
  } catch {
    try {
      dimension.spawnItem(new ItemStack("minecraft:experience_bottle", 6 + tier), at);
    } catch {
      // ไม่เป็นไร
    }
  }
  fx(dimension, "minecraft:totem_particle", at);
  sound(dimension, "random.totem", at);
  return rare;
}

/** @param {import("@minecraft/server").EntityDieAfterEvent} ev */
export function onBossDie(ev) {
  const dead = ev.deadEntity;
  const seen = lastSeen.get(dead.id);
  if (!seen) return;
  lastSeen.delete(dead.id);
  const hit = lastPlayerHit.get(dead.id);
  lastPlayerHit.delete(dead.id);
  lastHurt.delete(dead.id);

  let loc = seen.loc;
  try {
    loc = dead.location;
  } catch {
    // ใช้ตำแหน่งล่าสุดที่จำไว้
  }
  const def = BOSSES[seen.id];
  if (!hit) {
    world.sendMessage(`§7${def.name} ตายไปเอง... ไม่มีใครได้ของ`);
    return;
  }
  const rare = spawnLoot(seen.dim, loc, seen.id, seen.tier);
  world.sendMessage(`§6⚔ §e${hit.name} §6ปราบ §c${def.name} §6สำเร็จ!`);
  if (rare.length) world.sendMessage(`§d★ ดรอปของหายาก: ${rare.join("§7, ")}`);
}

// ---------------------------------------------------------------------------
// ท่าพิเศษ
// ---------------------------------------------------------------------------

function ready(boss, key, ticks) {
  const k = `${boss.id}:${key}`;
  const now = system.currentTick;
  if ((cooldowns.get(k) ?? 0) > now) return false;
  cooldowns.set(k, now + Math.round(boss.hasTag(ENRAGED_TAG) ? ticks * 0.6 : ticks));
  return true;
}

function summon(boss, type, count, cap) {
  const dim = boss.dimension;
  const loc = boss.location;
  let have = 0;
  try {
    have = dim.getEntities({ location: loc, maxDistance: 24, tags: [MINION_TAG] }).length;
  } catch {
    return;
  }
  const n = Math.min(count, cap - have);
  if (n <= 0) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const at = { x: loc.x + Math.cos(a) * 2, y: loc.y + 0.2, z: loc.z + Math.sin(a) * 2 };
    try {
      dim.spawnEntity(type, at).addTag(MINION_TAG);
      fx(dim, "minecraft:large_explosion", at);
    } catch {
      // ไม่เป็นไร
    }
  }
  sound(dim, "mob.evocation_illager.prepare_summon", loc);
}

/** กระโจนใส่เป้าหมาย */
function pounce(boss, target, power) {
  const b = boss.location;
  const t = target.location;
  const dx = t.x - b.x;
  const dz = t.z - b.z;
  const d = Math.hypot(dx, dz) || 1;
  try {
    boss.applyImpulse({ x: (dx / d) * power, y: 0.45, z: (dz / d) * power });
  } catch {
    // ไม่เป็นไร
  }
}

function hurtPlayersAround(boss, center, radius, damage, knock) {
  for (const p of playersNear(boss.dimension, center, radius)) {
    try {
      p.applyDamage(damage, { cause: EntityDamageCause.entityAttack, damagingEntity: boss });
      if (knock) {
        const dx = p.location.x - center.x;
        const dz = p.location.z - center.z;
        const d = Math.hypot(dx, dz) || 1;
        p.applyKnockback({ x: (dx / d) * knock, z: (dz / d) * knock }, 0.6);
      }
    } catch {
      // ไม่เป็นไร
    }
  }
}

/** ยิงลูกธนูจาก from ไปหา target */
function shootArrow(boss, from, target, spread) {
  const t = target.location;
  let dx = t.x - from.x + (Math.random() - 0.5) * spread;
  let dy = t.y + 1.2 - from.y;
  let dz = t.z - from.z + (Math.random() - 0.5) * spread;
  const d = Math.hypot(dx, dy, dz) || 1;
  const speed = 2.2;
  const v = { x: (dx / d) * speed, y: (dy / d) * speed + d * 0.012, z: (dz / d) * speed };
  try {
    const arrow = boss.dimension.spawnEntity("minecraft:arrow", from);
    const proj = arrow.getComponent("minecraft:projectile");
    if (proj) {
      proj.owner = boss;
      proj.shoot(v);
    } else {
      arrow.applyImpulse(v);
    }
  } catch {
    // ไม่เป็นไร
  }
}

function blinkAway(boss, target) {
  const t = target.location;
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 4;
    const to = { x: t.x + Math.cos(a) * r, y: t.y, z: t.z + Math.sin(a) * r };
    for (const dy of [0, 1, -1, 2]) {
      try {
        if (boss.tryTeleport({ ...to, y: to.y + dy }, { checkForBlocks: true })) {
          fx(boss.dimension, "minecraft:large_explosion", to);
          sound(boss.dimension, "mob.endermen.portal", to);
          return;
        }
      } catch {
        // ไม่เป็นไร
      }
    }
  }
}

function placeWeb(dim, loc) {
  const pos = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) };
  try {
    const block = dim.getBlock(pos);
    if (!block?.isAir) return;
    block.setType("minecraft:web");
    system.runTimeout(() => {
      try {
        const b = dim.getBlock(pos);
        if (b?.typeId === "minecraft:web") b.setType("minecraft:air");
      } catch {
        // ไม่เป็นไร
      }
    }, 60);
  } catch {
    // ไม่เป็นไร
  }
}

function fangLine(boss, target) {
  const b = boss.location;
  const t = target.location;
  const dx = t.x - b.x;
  const dz = t.z - b.z;
  const d = Math.hypot(dx, dz) || 1;
  for (let i = 0; i < 12; i++) {
    const step = 1.5 + i * 1.2;
    const at = { x: b.x + (dx / d) * step, y: Math.floor(t.y), z: b.z + (dz / d) * step };
    system.runTimeout(() => {
      try {
        boss.dimension.spawnEntity("minecraft:evocation_fang", at);
      } catch {
        // ไม่เป็นไร
      }
    }, i * 2);
  }
  sound(boss.dimension, "mob.evocation_illager.cast_spell", b);
}

const ABILITIES = {
  zombie_king(boss, target, d, tier) {
    if (d < 5 && ready(boss, "slam", 160)) {
      fx(boss.dimension, "minecraft:huge_explosion_emitter", boss.location);
      sound(boss.dimension, "random.explode", boss.location);
      hurtPlayersAround(boss, boss.location, 6, 4 + tier, 1.6);
    } else if (d > 6 && d < 16 && ready(boss, "leap", 100)) {
      pounce(boss, target, 1.1);
    }
    if (ready(boss, "summon", 300)) summon(boss, BOSSES.zombie_king.minion, 3, 6);
  },
  bone_lord(boss, target, d) {
    if (d < 4 && ready(boss, "blink", 120)) {
      blinkAway(boss, target);
      return;
    }
    if (d < 32 && ready(boss, "volley", 80)) {
      const from = { ...boss.location, y: boss.location.y + 1.6 };
      for (let i = 0; i < 5; i++) system.runTimeout(() => boss.isValid && shootArrow(boss, from, target, 2.5), i * 3);
      sound(boss.dimension, "random.bow", from);
    }
    if (ready(boss, "summon", 400)) summon(boss, BOSSES.bone_lord.minion, 2, 4);
  },
  brood_queen(boss, target, d) {
    if (d < 16 && ready(boss, "web", 140)) {
      placeWeb(boss.dimension, target.location);
      sound(boss.dimension, "mob.spider.say", boss.location);
    }
    if (d > 3 && d < 12 && ready(boss, "leap", 80)) pounce(boss, target, 1.2);
    if (ready(boss, "summon", 240)) summon(boss, BOSSES.brood_queen.minion, 3, 8);
  },
  wither_knight(boss, target, d, tier) {
    if (d > 3 && d < 14 && ready(boss, "dash", 120)) {
      pounce(boss, target, 1.4);
      sound(boss.dimension, "mob.wither.shoot", boss.location);
      system.runTimeout(() => {
        if (boss.isValid) hurtPlayersAround(boss, boss.location, 2.5, 8 + tier, 0.8);
      }, 8);
    }
    if (d < 6 && ready(boss, "aura", 100)) {
      fx(boss.dimension, "minecraft:large_explosion", boss.location);
      for (const p of playersNear(boss.dimension, boss.location, 6)) {
        try {
          p.addEffect("wither", 60, { amplifier: 0 });
        } catch {
          // ไม่เป็นไร
        }
      }
    }
    if (ready(boss, "summon", 400)) summon(boss, BOSSES.wither_knight.minion, 1, 3);
  },
  warlord(boss, target, d) {
    if (d > 2 && d < 16 && ready(boss, "fangs", 100)) fangLine(boss, target);
    if (ready(boss, "vex", 360)) summon(boss, BOSSES.warlord.minion, 2, 4);
    if (ready(boss, "warcry", 300)) {
      sound(boss.dimension, "raid.horn", boss.location, 2);
      try {
        for (const e of boss.dimension.getEntities({ location: boss.location, maxDistance: 16, families: ["illager"] })) {
          e.addEffect("strength", 200, { amplifier: 0 });
          e.addEffect("speed", 200, { amplifier: 0 });
        }
      } catch {
        // ไม่เป็นไร
      }
    }
  },
};

function think(boss) {
  const id = bossId(boss);
  if (!id) return;
  remember(boss, id);
  const tick = system.currentTick;
  const loc = boss.location;

  const targets = playersNear(boss.dimension, loc, 24);
  if (!targets.length) {
    // ไม่มีใครสู้ด้วยนาน 30 วินาที -> ฟื้นเลือด
    if (tick % 20 === 0 && tick - (lastHurt.get(boss.id) ?? 0) > 600) {
      const max = num(boss, P_MAX, 1);
      const hp = num(boss, P_HP);
      if (hp < max) {
        boss.setDynamicProperty(P_HP, Math.min(max, hp + max * 0.02));
        updateName(boss, id);
      }
    }
    return;
  }
  let target = targets[0];
  let best = dist(target.location, loc);
  for (const p of targets) {
    const d = dist(p.location, loc);
    if (d < best) {
      best = d;
      target = p;
    }
  }
  ABILITIES[id](boss, target, best, num(boss, P_TIER));
}

/** เรียกทุก 10 tick */
export function bossTick() {
  const seen = new Set();
  const showBar = system.currentTick % 20 === 0;
  for (const player of world.getAllPlayers()) {
    let bosses;
    try {
      bosses = player.dimension.getEntities({ location: player.location, maxDistance: 48, tags: [BOSS_TAG] });
    } catch {
      continue;
    }
    let nearest;
    let nearestD = 33;
    for (const boss of bosses) {
      if (!seen.has(boss.id)) {
        seen.add(boss.id);
        try {
          think(boss);
        } catch {
          // บอสหายไประหว่างทาง
        }
      }
      const d = dist(boss.location, player.location);
      if (d < nearestD) {
        nearestD = d;
        nearest = boss;
      }
    }
    if (showBar && nearest?.isValid) {
      const id = bossId(nearest);
      if (id) {
        try {
          player.onScreenDisplay.setActionBar(bossTitle(nearest, id).replace("\n", "  "));
        } catch {
          // ไม่เป็นไร
        }
      }
    }
  }
  if (system.currentTick % 1200 === 0) {
    const now = system.currentTick;
    for (const [k, t] of cooldowns) if (t < now) cooldowns.delete(k);
  }
}

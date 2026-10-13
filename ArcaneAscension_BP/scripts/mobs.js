import { world, system, EntityDamageCause } from "@minecraft/server";
import { DIMENSION_ID } from "./config.js";
import { launch } from "./projectiles.js";
import { spellDamage, aoe } from "./combat.js";
import { fx, COL, sound } from "./fx.js";
import { V, alive, randInt, centerOf, eyeOf, safe, playersNear, hpPct } from "./util.js";

// ---------- อัญเชิญ (หมาป่าวิญญาณ) ----------
const summons = new Map(); // id -> { entity, ownerId, expire }

export function trackSummon(entity, owner, ticks) {
  summons.set(entity.id, { entity, ownerId: owner.id, expire: system.currentTick + ticks });
}

function poof(e) {
  safe(() => {
    fx.smoke(e.dimension, V.up(e.location, 0.5), { red: 0.6, green: 0.9, blue: 1 }, 0.6, 10, 0.6);
    fx.rise(e.dimension, e.location, COL.frost, 0.6, 10, 2);
    e.remove();
  });
}

let summonBeat = 0;

function tickSummons() {
  const tick = system.currentTick;
  summonBeat++;
  for (const [id, s] of summons) {
    if (!alive(s.entity)) {
      summons.delete(id);
      continue;
    }
    const owner = world.getEntity(s.ownerId);
    if (tick >= s.expire || !owner || !alive(owner) || owner.dimension.id !== s.entity.dimension.id) {
      summons.delete(id);
      poof(s.entity);
      continue;
    }
    if (V.dist(owner.location, s.entity.location) > 24) safe(() => s.entity.teleport(owner.location));
    if (summonBeat % 2 === 0) fx.orb(s.entity.dimension, V.up(s.entity.location, 0.6), COL.frost, 0.3, 0.6);
  }
}

// ---------- AI เสริมของมอนสเตอร์ ----------
const AI_TYPES = new Set(["arc:void_wraith", "arc:ember_imp", "arc:rift_stalker", "arc:crystal_golem"]);
const ATTACK_ANIM = {
  "arc:void_wraith": "animation.arc.void_wraith.attack",
  "arc:crystal_golem": "animation.arc.crystal_golem.attack",
  "arc:ember_imp": "animation.arc.ember_imp.attack",
  "arc:rift_stalker": "animation.arc.rift_stalker.attack",
  "arc:ember_colossus": "animation.arc.ember_colossus.slam",
  "arc:void_titan": "animation.arc.void_titan.slam",
};
const mobs = new Map(); // id -> { entity, next }

function track(e) {
  if (!AI_TYPES.has(e.typeId) || mobs.has(e.id)) return;
  mobs.set(e.id, { entity: e, next: system.currentTick + randInt(40, 100) });
}

function targetOf(e, range) {
  const list = playersNear(e.dimension, e.location, range);
  return list[0];
}

function wraithBolt(e, target) {
  safe(() => e.playAnimation("animation.arc.void_wraith.cast"));
  system.runTimeout(() => {
    if (!alive(e) || !alive(target)) return;
    const from = V.up(e.location, 1.6);
    const dir = V.norm(V.sub(centerOf(target), from));
    launch({
      dim: e.dimension, pos: V.add(from, dir), vel: V.mul(dir, 0.7), owner: e, life: 60, radius: 0.5,
      homing: target, turn: 0.07, ignoreBlocks: false,
      trail: (dim, pos) => {
        fx.orb(dim, pos, COL.void, 0.35, 0.35);
        fx.orb(dim, pos, COL.voidDark, 0.2, 0.25);
      },
      onHitEntity: (hit) => {
        spellDamage(hit, 4, e);
        safe(() => hit.addEffect("wither", 40, { amplifier: 0 }));
        fx.burst(hit.dimension, centerOf(hit), COL.void, 10, 3);
      },
      onHitBlock: (pos) => fx.burst(e.dimension, pos, COL.void, 6, 2),
    });
    sound(e.dimension, "mob.vex.charge", from, 0.8, 0.7);
  }, 10);
}

function impFireball(e, target) {
  safe(() => e.playAnimation("animation.arc.ember_imp.attack"));
  system.runTimeout(() => {
    if (!alive(e) || !alive(target)) return;
    const from = V.up(e.location, 1.2);
    const to = centerOf(target);
    const d = V.dist(from, to);
    const dir = V.norm(V.sub(to, from));
    const vel = V.mul(dir, 0.8);
    vel.y += d * 0.012;
    let done = false;
    const boom = (pos) => {
      if (done) return;
      done = true;
      fx.burst(e.dimension, pos, COL.fire, 14, 4);
      fx.vanilla(e.dimension, "minecraft:lava_particle", pos);
      sound(e.dimension, "mob.ghast.fireball", pos, 0.5, 1.5);
      if (alive(e)) aoe(e, e.dimension, pos, 1.8, 3, { fire: 3 });
    };
    launch({
      dim: e.dimension, pos: from, vel, gravity: 0.02, owner: e, life: 50, radius: 0.4,
      trail: (dim, pos) => {
        fx.orb(dim, pos, COL.fire, 0.3, 0.25);
        if (Math.random() < 0.3) fx.vanilla(dim, "minecraft:basic_flame_particle", pos);
      },
      onHitEntity: (h, p) => {
        boom(p.pos);
        return true;
      },
      onHitBlock: boom,
      onExpire: boom,
    });
    sound(e.dimension, "mob.blaze.shoot", from, 0.5, 1.6);
  }, 8);
}

function stalkerBlink(e, target) {
  const view = safe(() => target.getViewDirection()) ?? { x: 0, y: 0, z: 1 };
  const behind = { x: target.location.x - view.x * 2, y: target.location.y, z: target.location.z - view.z * 2 };
  const b0 = safe(() => e.dimension.getBlock(V.floor(behind)));
  const b1 = safe(() => e.dimension.getBlock(V.floor(V.up(behind, 1))));
  if (!b0 || !b1 || !b0.isAir || !b1.isAir) return;
  fx.smoke(e.dimension, V.up(e.location, 1), { red: 0.15, green: 0.05, blue: 0.25 }, 0.6, 10, 0.8);
  fx.implode(e.dimension, V.up(e.location, 1), COL.void, 1.5, 12);
  safe(() => e.teleport(behind, { facingLocation: eyeOf(target) }));
  fx.smoke(e.dimension, V.up(behind, 1), { red: 0.15, green: 0.05, blue: 0.25 }, 0.6, 10, 0.8);
  sound(e.dimension, "mob.endermen.portal", behind, 0.7, 0.7);
  system.runTimeout(() => {
    if (!alive(e) || !alive(target)) return;
    safe(() => e.playAnimation("animation.arc.rift_stalker.attack"));
    if (V.dist(e.location, target.location) < 3.2) spellDamage(target, 6, e, EntityDamageCause.entityAttack);
  }, 6);
}

function tickMobs() {
  const tick = system.currentTick;
  for (const [id, m] of mobs) {
    const e = m.entity;
    if (!alive(e)) {
      mobs.delete(id);
      continue;
    }
    if (tick < m.next) continue;
    m.next = tick + 20;
    if (e.typeId === "arc:void_wraith") {
      const t = targetOf(e, 16);
      if (t) {
        wraithBolt(e, t);
        m.next = tick + randInt(80, 120);
      }
    } else if (e.typeId === "arc:ember_imp") {
      const t = targetOf(e, 14);
      if (t && V.dist(t.location, e.location) > 3) {
        impFireball(e, t);
        m.next = tick + randInt(90, 140);
      }
    } else if (e.typeId === "arc:rift_stalker") {
      const t = targetOf(e, 12);
      if (t && V.dist(t.location, e.location) > 4) {
        stalkerBlink(e, t);
        m.next = tick + randInt(120, 180);
      }
    } else if (e.typeId === "arc:crystal_golem") {
      m.next = tick + 40;
    }
  }
}

function rescan() {
  for (const dimId of ["overworld", "nether", "the_end", DIMENSION_ID]) {
    const dim = safe(() => world.getDimension(dimId));
    if (!dim) continue;
    for (const type of AI_TYPES) safe(() => dim.getEntities({ type }).forEach(track));
  }
}

export function trackMob(e) {
  track(e);
}

export function initMobs() {
  world.afterEvents.entitySpawn.subscribe((ev) => {
    const e = ev.entity;
    if (alive(e)) track(e);
  });
  world.afterEvents.entityLoad.subscribe((ev) => {
    const e = ev.entity;
    if (!alive(e)) return;
    if (e.typeId === "arc:spirit_wolf" && !summons.has(e.id)) {
      // หมาป่าที่ค้างจากการเซฟเกม -> หายไป
      system.run(() => poof(e));
      return;
    }
    track(e);
  });
  world.afterEvents.entityHitEntity.subscribe((ev) => {
    const a = ev.damagingEntity;
    const anim = ATTACK_ANIM[a?.typeId];
    if (anim) safe(() => a.playAnimation(anim, { blendOutTime: 0.2 }));
    if (a?.typeId === "arc:ember_imp" && alive(ev.hitEntity)) safe(() => ev.hitEntity.setOnFire(3, true));
  });
  world.afterEvents.entityHurt.subscribe((ev) => {
    const e = ev.hurtEntity;
    if (e.typeId !== "arc:crystal_golem" || !alive(e)) return;
    if (hpPct(e) > 0.5 || safe(() => e.getDynamicProperty("arc:burst"))) return;
    safe(() => e.setDynamicProperty("arc:burst", true));
    const c = centerOf(e);
    fx.shards(e.dimension, c, COL.arcane, 40, 9, 0.2);
    fx.ring(e.dimension, e.location, 4.5, COL.arcane, 0.5);
    sound(e.dimension, "break.amethyst_block", c, 1.5, 0.6);
    aoe(e, e.dimension, c, 4.5, 6, { knock: 0.9, lift: 0.4 });
    safe(() => e.addEffect("resistance", 100, { amplifier: 1 }));
  });
  system.runInterval(tickMobs, 5);
  system.runInterval(tickSummons, 10);
  system.runInterval(rescan, 600);
  system.runTimeout(rescan, 40);
}

import { world, system, EasingType, EntityDamageCause, EntityWaypoint, WaypointTexture, Difficulty } from "@minecraft/server";
import { getData } from "./data.js";
import { aoe, spellDamage, shielded, vulnerable } from "./combat.js";
import { launch } from "./projectiles.js";
import { fx, COL, sound, shakeNear, fade, pushFog, popFog } from "./fx.js";
import { V, alive, rand, pick, hpPct, centerOf, eyeOf, safe, title, playersNear, groundY, onCircle, actionbar, consumeItem, isCreative } from "./util.js";

const INFO = {
  "arc:ember_colossus": { name: "§6§lยักษ์เพลิงโคลอสซัส", sub: "§7เปลวเพลิงจากแกนโลก", height: 4, wp: { red: 1, green: 0.5, blue: 0.1 }, roar: "animation.arc.ember_colossus.roar" },
  "arc:void_titan": { name: "§5§lไททันแห่งความว่างเปล่า", sub: "§7ผู้กลืนกินดวงดาว", height: 5, wp: { red: 0.8, green: 0.3, blue: 1 }, roar: "animation.arc.void_titan.roar" },
};
export const BOSS_TYPES = new Set(Object.keys(INFO));

const bosses = new Map(); // id -> state
let waypointsOk = true;

export function bossNear(dim, loc, radius) {
  for (const st of bosses.values()) {
    if (!alive(st.entity)) continue;
    if (st.entity.dimension.id === dim.id && V.dist(st.entity.location, loc) <= radius) return st.entity;
  }
  return undefined;
}

function phaseName(st) {
  return `${INFO[st.type].name} §r§7[ระยะ ${["", "I", "II", "III"][st.phase] ?? st.phase}]`;
}

export function registerBoss(e, isNew = false) {
  if (bosses.has(e.id) || !INFO[e.typeId]) return;
  const st = {
    entity: e, type: e.typeId, home: { ...e.location }, phase: 1, next: system.currentTick + 60, introUntil: 0,
    crystals: [], shieldUp: false, lastSummon: 0, stunUntil: 0, waypoints: new Map(), fogged: new Set(),
  };
  const home = safe(() => e.getDynamicProperty("arc:home"));
  if (home && typeof home === "object") st.home = home;
  else safe(() => e.setDynamicProperty("arc:home", st.home));
  const ph = safe(() => e.getDynamicProperty("arc:phase"));
  if (typeof ph === "number") st.phase = ph;
  bosses.set(e.id, st);
  safe(() => (e.nameTag = phaseName(st)));
  if (isNew) system.runTimeout(() => alive(e) && intro(st), 2);
}

function setPhase(st, phase) {
  st.phase = phase;
  safe(() => st.entity.setDynamicProperty("arc:phase", phase));
  safe(() => (st.entity.nameTag = phaseName(st)));
}

// ---------- คัตซีนเปิดตัว ----------
function intro(st) {
  const e = st.entity;
  const info = INFO[st.type];
  st.introUntil = system.currentTick + 70;
  safe(() => e.playAnimation(info.roar));
  sound(e.dimension, st.type === "arc:void_titan" ? "mob.enderdragon.growl" : "mob.ravager.roar", e.location, 3, 0.6);
  fx.ring(e.dimension, e.location, 10, st.type === "arc:void_titan" ? COL.void : COL.fire, 1.2);
  shakeNear(e.dimension, e.location, 40, 0.5, 2);
  for (const p of playersNear(e.dimension, e.location, 48, true)) {
    title(p, info.name, info.sub, 10, 60, 20);
    if (getData(p).set.cine) cinematic(p, e, info.height);
  }
}

function cinematic(p, e, height) {
  try {
    const base = { ...e.location };
    const head = V.up(base, height * 0.75);
    const to = V.norm({ x: p.location.x - base.x, y: 0, z: p.location.z - base.z });
    const side = { x: -to.z, y: 0, z: to.x };
    const camA = { x: base.x + to.x * (height * 2) + side.x * 3, y: base.y + height * 0.5, z: base.z + to.z * (height * 2) + side.z * 3 };
    const camB = { x: base.x + to.x * (height * 1.6) - side.x * 4, y: base.y + height * 0.9, z: base.z + to.z * (height * 1.6) - side.z * 4 };
    p.camera.setCamera("minecraft:free", { location: eyeOf(p), facingLocation: head });
    p.camera.setCamera("minecraft:free", { location: camA, facingLocation: head, easeOptions: { easeTime: 1.5, easeType: EasingType.InOutSine } });
    safe(() => p.addEffect("resistance", 80, { amplifier: 4, showParticles: false }));
    system.runTimeout(() => {
      if (alive(p)) safe(() => p.camera.setCamera("minecraft:free", { location: camB, facingLocation: head, easeOptions: { easeTime: 1.6, easeType: EasingType.Linear } }));
    }, 32);
    system.runTimeout(() => alive(p) && fade(p, { red: 0, green: 0, blue: 0 }, 0.25, 0.15, 0.4), 62);
    system.runTimeout(() => alive(p) && safe(() => p.camera.clear()), 68);
  } catch {
    safe(() => p.camera.clear());
  }
}

// ---------- เครื่องหมายบอสบนแถบตำแหน่ง ----------
function updateWaypoints(st) {
  if (!waypointsOk) return;
  const e = st.entity;
  try {
    for (const p of playersNear(e.dimension, e.location, 96, true)) {
      if (st.waypoints.has(p.id)) continue;
      const wp = new EntityWaypoint(e, { textureBoundsList: [{ lowerBound: 0, texture: WaypointTexture.SmallStar }] }, { showDead: false }, INFO[st.type].wp);
      p.locatorBar.addWaypoint(wp);
      st.waypoints.set(p.id, wp);
    }
  } catch (err) {
    waypointsOk = false;
    console.warn(`[Arcane] waypoints disabled: ${err}`);
  }
}

function clearWaypoints(st) {
  for (const [pid, wp] of st.waypoints) {
    const p = /** @type {import("@minecraft/server").Player | undefined} */ (world.getEntity(pid));
    safe(() => p?.locatorBar.removeWaypoint(wp));
    safe(() => wp.remove());
  }
  st.waypoints.clear();
}

// ---------- ท่าโจมตีร่วม ----------
function target(st, range) {
  const list = playersNear(st.entity.dimension, st.entity.location, range);
  return list.length ? pick(list.slice(0, 3)) : undefined;
}

function slam(st, radius, damage, color) {
  const e = st.entity;
  safe(() => e.playAnimation(st.type === "arc:void_titan" ? "animation.arc.void_titan.slam" : "animation.arc.ember_colossus.slam"));
  system.runTimeout(() => {
    if (!alive(e)) return;
    const loc = { ...e.location };
    for (let k = 0; k < 3; k++) system.runTimeout(() => fx.ring(e.dimension, loc, (radius / 3) * (k + 1), color, 0.5), k * 3);
    fx.burst(e.dimension, V.up(loc, 0.3), color, 30, 7, 0.22);
    fx.vanilla(e.dimension, "minecraft:smash_ground_particle_center", loc);
    sound(e.dimension, "random.explode", loc, 1.2, 0.6);
    shakeNear(e.dimension, loc, 24, 0.5, 0.6);
    aoe(e, e.dimension, V.up(loc, 0.5), radius, damage, { knock: 1.1, lift: 0.6, minFrac: 0.5, cause: EntityDamageCause.entityAttack, fire: st.type === "arc:ember_colossus" ? 3 : 0 });
  }, st.type === "arc:void_titan" ? 15 : 13);
}

function boltVolley(st, t, count, color, damage, effect) {
  const e = st.entity;
  safe(() => e.playAnimation(st.type === "arc:void_titan" ? "animation.arc.void_titan.cast" : "animation.arc.ember_colossus.throw"));
  const h = INFO[st.type].height;
  for (let i = 0; i < count; i++) {
    system.runTimeout(() => {
      if (!alive(e) || !alive(t)) return;
      const from = V.add(V.up(e.location, h * 0.8), { x: rand(-1.5, 1.5), y: rand(-0.5, 1), z: rand(-1.5, 1.5) });
      const dir = V.norm(V.sub(centerOf(t), from));
      const spread = { x: dir.x + rand(-0.25, 0.25), y: dir.y + rand(0, 0.3), z: dir.z + rand(-0.25, 0.25) };
      let done = false;
      const hit = (pos) => {
        if (done) return;
        done = true;
        fx.burst(e.dimension, pos, color, 12, 4);
        if (alive(e)) aoe(e, e.dimension, pos, 2, damage, { fire: st.type === "arc:ember_colossus" ? 3 : 0, effect });
      };
      launch({
        dim: e.dimension, pos: from, vel: V.mul(V.norm(spread), 0.75), owner: e, life: 70, radius: 0.6,
        homing: st.type === "arc:void_titan" ? t : undefined, turn: 0.06,
        trail: (dim, pos) => {
          fx.orb(dim, pos, color, 0.45, 0.3);
          fx.orb(dim, pos, COL.white, 0.15, 0.15);
        },
        onHitEntity: (x, p) => {
          hit(p.pos);
          return true;
        },
        onHitBlock: hit,
        onExpire: hit,
      });
      sound(e.dimension, st.type === "arc:void_titan" ? "mob.wither.shoot" : "mob.ghast.fireball", from, 0.7, 1.2);
    }, 8 + i * 5);
  }
}

function telegraphStrike(st, pos, radius, delay, color, onStrike) {
  const e = st.entity;
  fx.rune(e.dimension, pos, radius, color, delay / 20 + 0.2, 160);
  let n = 0;
  const id = system.runInterval(() => {
    fx.circle(e.dimension, pos, radius, COL.red, 20, 0.18, 0.3);
    if ((n += 5) >= delay) system.clearRun(id);
  }, 5);
  system.runTimeout(() => {
    if (alive(e)) onStrike(pos);
  }, delay);
}

function summonMinions(st, type, n) {
  const e = st.entity;
  for (let i = 0; i < n; i++) {
    const loc = onCircle(e.location, 3.5, (i / n) * Math.PI * 2 + rand(0, 1), 0.2);
    try {
      const m = e.dimension.spawnEntity(type, loc);
      if (e.hasTag("arc_rift")) for (const tag of e.getTags()) if (tag.startsWith("arc_rift")) m.addTag(tag);
      fx.smoke(e.dimension, V.up(loc, 1), { red: 0.2, green: 0.1, blue: 0.3 }, 0.6, 10, 0.8);
    } catch {}
  }
  sound(e.dimension, "mob.evocation_illager.prepare_summon", e.location, 1.5, 0.8);
}

// ---------- ยักษ์เพลิง ----------
function colossusAI(st, tick) {
  const e = st.entity;
  if (st.phase === 1 && hpPct(e) <= 0.5) {
    setPhase(st, 2);
    safe(() => e.triggerEvent("arc:enrage"));
    safe(() => e.playAnimation(INFO[st.type].roar));
    sound(e.dimension, "mob.ravager.roar", e.location, 3, 0.5);
    for (const p of playersNear(e.dimension, e.location, 48, true)) title(p, "§6§lยักษ์เพลิงคลั่ง!", "§7ระวังไฟรอบตัวมัน", 5, 40, 10);
    summonMinions(st, "arc:ember_imp", 3);
    st.lastSummon = tick;
    st.next = tick + 40;
    return;
  }
  if (st.phase === 2 && beat % 10 === 0) {
    fx.ring(e.dimension, e.location, 3.5, COL.fire, 0.5);
    fx.vanilla(e.dimension, "minecraft:mobflame_single", V.up(e.location, 2));
    aoe(e, e.dimension, V.up(e.location, 1), 3.5, 3, { fire: 2, cause: EntityDamageCause.fire });
  }
  if (tick < st.next) return;
  const t = target(st, 40);
  if (!t) {
    st.next = tick + 20;
    return;
  }
  const d = V.dist(t.location, e.location);
  const roll = Math.random();
  let cd;
  if (d < 7 && roll < 0.55) {
    slam(st, 7.5, 12, COL.fire);
    cd = 70;
  } else if (roll < 0.78) {
    boltVolley(st, t, st.phase === 2 ? 5 : 3, COL.fire, 6);
    cd = 65;
  } else {
    for (const p of playersNear(e.dimension, e.location, 24).slice(0, 4)) {
      telegraphStrike(st, { ...p.location }, 2.2, 30, COL.fire, (pos) => {
        for (let y = 0; y < 5; y++) fx.vanilla(e.dimension, "minecraft:lava_particle", V.up(pos, y * 0.8));
        fx.burst(e.dimension, V.up(pos, 0.5), COL.fire, 24, 7, 0.22);
        sound(e.dimension, "mob.ghast.fireball", pos, 1, 0.6);
        aoe(e, e.dimension, V.up(pos, 0.5), 2.2, 10, { lift: 1.1, knock: 0.2, fire: 4 });
      });
    }
    sound(e.dimension, "mob.blaze.breathe", e.location, 2, 0.5);
    cd = 80;
  }
  if (st.phase === 2 && tick - st.lastSummon > 500) {
    summonMinions(st, "arc:ember_imp", 2);
    st.lastSummon = tick;
  }
  st.next = tick + (st.phase === 2 ? Math.round(cd * 0.7) : cd);
}

// ---------- ไททัน ----------
function enterShield(st, tick) {
  const e = st.entity;
  setPhase(st, 2);
  safe(() => e.playAnimation(INFO[st.type].roar));
  sound(e.dimension, "mob.wither.spawn", e.location, 2, 0.7);
  for (const p of playersNear(e.dimension, e.location, 48, true)) title(p, "§5§lโล่แห่งความว่างเปล่า!", "§dทำลายผลึกทั้ง 4 ก้อนเพื่อทำลายโล่", 5, 60, 15);
  st.crystals = [];
  for (let i = 0; i < 4; i++) {
    const p = onCircle(st.home, 9, Math.PI / 4 + (i * Math.PI) / 2);
    const loc = { x: p.x, y: groundY(e.dimension, { x: p.x, y: st.home.y + 6, z: p.z }, 20), z: p.z };
    try {
      const c = e.dimension.spawnEntity("arc:void_crystal", loc);
      for (const tag of e.getTags()) if (tag.startsWith("arc_rift")) c.addTag(tag);
      st.crystals.push(c);
      fx.rise(e.dimension, loc, COL.void, 1, 20, 3);
    } catch {}
  }
  shielded.add(e.id);
  st.shieldUp = true;
  st.lastSummon = tick;
}

function tickShield(st, tick) {
  const e = st.entity;
  const live = st.crystals.filter(alive);
  if (st.shieldUp && live.length === 0) {
    st.shieldUp = false;
    shielded.delete(e.id);
    vulnerable.set(e.id, 1.5);
    st.stunUntil = tick + 80;
    safe(() => e.addEffect("slowness", 80, { amplifier: 255, showParticles: false }));
    for (let k = 0; k < 3; k++) system.runTimeout(() => sound(e.dimension, "random.glass", e.location, 2, 0.6 + k * 0.2), k * 4);
    fx.shards(e.dimension, centerOf(e), COL.pink, 60, 10, 0.25);
    for (const p of playersNear(e.dimension, e.location, 48, true)) title(p, "§d§lโล่แตกแล้ว!", "§7ไททันมึนงง — โจมตีแรงขึ้น 50%!", 5, 40, 10);
    system.runTimeout(() => vulnerable.delete(e.id), 80);
    return;
  }
  if (!st.shieldUp) return;
  if (beat % 5 === 0) {
    for (const c of live) fx.line(e.dimension, V.up(c.location, 1.6), centerOf(e), COL.void, 0.9, 0.18, 0.5);
    fx.implode(e.dimension, centerOf(e), COL.void, 3, 10, 0.2);
  }
  if (tick - st.lastSummon > 300) {
    summonMinions(st, "arc:void_wraith", 2);
    st.lastSummon = tick;
  }
}

function voidLaser(st, t) {
  const e = st.entity;
  safe(() => e.playAnimation("animation.arc.void_titan.laser"));
  sound(e.dimension, "beacon.activate", e.location, 2, 0.5);
  const head = () => V.up(e.location, 4.4);
  let dir = V.norm(V.sub(centerOf(t), head()));
  let tick = 0;
  const lastHit = new Map();
  const id = system.runInterval(() => {
    tick++;
    if (!alive(e) || tick > 60) {
      system.clearRun(id);
      return;
    }
    const from = head();
    if (alive(t)) dir = V.norm(V.lerp(dir, V.norm(V.sub(centerOf(t), from)), tick < 24 ? 0.25 : 0.06));
    let len = 32;
    try {
      const hit = e.dimension.getBlockFromRay(from, dir, { maxDistance: 32, includePassableBlocks: false });
      if (hit) len = V.dist(from, V.add(hit.block.location, hit.faceLocation));
    } catch {}
    const to = V.add(from, V.mul(dir, len));
    if (tick < 24) {
      if (tick % 3 === 0) fx.line(e.dimension, from, to, COL.red, 1.2, 0.1, 0.2);
      return;
    }
    if (tick === 24) sound(e.dimension, "mob.guardian.attack_loop", from, 2, 0.6);
    fx.line(e.dimension, from, to, COL.void, 0.7, 0.35, 0.12);
    if (tick % 2 === 0) fx.line(e.dimension, from, to, COL.white, 1.4, 0.15, 0.1);
    fx.burst(e.dimension, to, COL.pink, 6, 3, 0.12);
    for (const p of playersNear(e.dimension, from, len + 2)) {
      const rel = V.sub(centerOf(p), from);
      const along = V.dot(rel, dir);
      if (along < 0 || along > len) continue;
      const off = V.len(V.sub(rel, V.mul(dir, along)));
      if (off > 1.4) continue;
      if ((lastHit.get(p.id) ?? -99) + 6 > tick) continue;
      lastHit.set(p.id, tick);
      spellDamage(p, 5, e);
      safe(() => p.applyKnockback({ x: dir.x * 0.6, z: dir.z * 0.6 }, 0.2));
    }
  }, 1);
}

function meteorRain(st) {
  const e = st.entity;
  safe(() => e.playAnimation("animation.arc.void_titan.cast"));
  sound(e.dimension, "mob.wither.ambient", e.location, 2, 0.5);
  const players = playersNear(e.dimension, e.location, 32);
  if (!players.length) return;
  for (let i = 0; i < 8; i++) {
    system.runTimeout(() => {
      if (!alive(e)) return;
      const p = pick(players);
      if (!alive(p)) return;
      const ground = onCircle(p.location, rand(0, 4), rand(0, Math.PI * 2));
      const pos = { x: ground.x, y: groundY(e.dimension, V.up(ground, 3), 12), z: ground.z };
      telegraphStrike(st, pos, 3, 26, COL.void, () => {});
      const sky = V.add(pos, { x: rand(-5, 5), y: 24, z: rand(-5, 5) });
      let done = false;
      const boom = (at) => {
        if (done) return;
        done = true;
        fx.vanilla(e.dimension, "minecraft:huge_explosion_emitter", at);
        fx.ring(e.dimension, at, 3, COL.void, 0.5);
        sound(e.dimension, "random.explode", at, 1, 0.8);
        shakeNear(e.dimension, at, 16, 0.35, 0.4);
        if (alive(e)) aoe(e, e.dimension, V.up(at, 0.5), 3, 10, { knock: 0.7, lift: 0.5 });
      };
      launch({
        dim: e.dimension, pos: sky, vel: V.mul(V.sub(pos, sky), 1 / 26), owner: e, life: 34, radius: 0.9,
        trail: (dim, at) => {
          fx.orb(dim, at, COL.void, 0.9, 0.4);
          fx.orb(dim, at, COL.pink, 0.4, 0.3);
        },
        onHitEntity: (x, pr) => {
          boom(pr.pos);
          return true;
        },
        onHitBlock: boom,
        onExpire: boom,
      });
    }, i * 6);
  }
}

function shadowStep(st, t) {
  const e = st.entity;
  const view = safe(() => t.getViewDirection()) ?? { x: 0, y: 0, z: 1 };
  const dest = { x: t.location.x - view.x * 3.5, y: t.location.y, z: t.location.z - view.z * 3.5 };
  if (V.dist(dest, st.home) > 18) return false;
  fx.implode(e.dimension, centerOf(e), COL.void, 4, 30, 0.3);
  fx.smoke(e.dimension, centerOf(e), { red: 0.1, green: 0, blue: 0.2 }, 2, 16, 1.4);
  safe(() => e.teleport(dest, { facingLocation: t.location }));
  fx.burst(e.dimension, centerOf(e), COL.void, 30, 6);
  sound(e.dimension, "mob.endermen.portal", dest, 2, 0.5);
  system.runTimeout(() => alive(e) && slam(st, 4.5, 10, COL.void), 6);
  return true;
}

function titanAI(st, tick) {
  const e = st.entity;
  const pct = hpPct(e);
  if (st.phase === 1 && pct <= 0.66) {
    enterShield(st, tick);
    st.next = tick + 60;
    return;
  }
  if (st.phase === 2) tickShield(st, tick);
  if (st.phase === 2 && !st.shieldUp && pct <= 0.33) {
    setPhase(st, 3);
    safe(() => e.triggerEvent("arc:enrage"));
    safe(() => e.playAnimation(INFO[st.type].roar));
    sound(e.dimension, "mob.enderdragon.growl", e.location, 3, 0.5);
    for (const p of playersNear(e.dimension, e.location, 48, true)) {
      title(p, "§5§lไททันคลั่ง!", "§7ความว่างเปล่ากลืนกินทุกสิ่ง", 5, 50, 15);
      pushFog(p, "arc:cataclysm", "arc_boss");
      st.fogged.add(p.id);
    }
    st.next = tick + 50;
    return;
  }
  if (tick < st.next || tick < st.stunUntil) return;
  const t = target(st, 48);
  if (!t) {
    st.next = tick + 20;
    return;
  }
  const d = V.dist(t.location, e.location);
  const roll = Math.random();
  let cd = 60;
  if (st.phase === 3 && roll < 0.3) {
    voidLaser(st, t);
    cd = 75;
  } else if (st.phase === 3 && roll < 0.5) {
    meteorRain(st);
    cd = 70;
  } else if (d < 8 && roll < 0.75) {
    slam(st, 8, 15, COL.void);
    cd = 65;
  } else if (roll < 0.85 || !shadowStep(st, t)) {
    boltVolley(st, t, st.phase === 3 ? 7 : 5, COL.void, 7, ["wither", 60, 0]);
    cd = 70;
  } else {
    cd = 45;
  }
  st.next = tick + (st.phase === 3 ? Math.round(cd * 0.75) : cd);
}

// ---------- ตาย / ลบ ----------
function cleanup(st, died) {
  shielded.delete(st.entity.id);
  vulnerable.delete(st.entity.id);
  clearWaypoints(st);
  for (const pid of st.fogged) {
    const p = world.getEntity(pid);
    if (p) popFog(p, "arc_boss");
  }
  if (died) for (const c of st.crystals) if (alive(c)) safe(() => c.kill());
}

function deathShow(typeId, dim, loc) {
  const color = typeId === "arc:void_titan" ? COL.void : COL.fire;
  for (let i = 0; i < 6; i++) {
    system.runTimeout(() => {
      fx.vanilla(dim, "minecraft:huge_explosion_emitter", V.add(loc, { x: rand(-2, 2), y: rand(1, 4), z: rand(-2, 2) }));
      fx.burst(dim, V.up(loc, 2), color, 30, 8, 0.25);
      fx.ring(dim, loc, 3 + i * 2, color, 0.6);
    }, i * 6);
  }
  sound(dim, typeId === "arc:void_titan" ? "mob.enderdragon.death" : "mob.wither.death", loc, 3, 0.8);
  for (const p of playersNear(dim, loc, 64, true)) {
    title(p, "§6§l✦ ชัยชนะ! ✦", `§7คุณพิชิต ${INFO[typeId].name}§r§7 แล้ว`, 10, 70, 20);
    fade(p, { red: 1, green: 1, blue: 1 }, 0.05, 0.1, 0.8);
  }
}

// ---------- อัญเชิญด้วยตรา ----------
export function summonWithSigil(player, item) {
  const type = item.typeId === "arc:ember_sigil" ? "arc:ember_colossus" : "arc:void_titan";
  if (world.getDifficulty() === Difficulty.Peaceful) {
    actionbar(player, "§cอัญเชิญบอสไม่ได้ในโหมด Peaceful");
    return;
  }
  if (bossNear(player.dimension, player.location, 64)) {
    actionbar(player, "§cมีบอสอยู่ใกล้ ๆ แล้ว");
    return;
  }
  if (!isCreative(player) && !consumeItem(player, item.typeId, 1)) return;
  const dim = player.dimension;
  const dir = player.getViewDirection();
  const p = { x: player.location.x + dir.x * 8, y: player.location.y, z: player.location.z + dir.z * 8 };
  const loc = { x: p.x, y: groundY(dim, V.up(p, 5), 20), z: p.z };
  const color = type === "arc:void_titan" ? COL.void : COL.fire;
  sound(dim, "mob.evocation_illager.prepare_summon", loc, 2, 0.6);
  let t = 0;
  const id = system.runInterval(() => {
    t += 5;
    fx.rune(dim, loc, 3 + t / 20, color, 0.4, 200);
    fx.swirl(dim, V.up(loc, 0.5), color, 4, 8);
    if (t % 20 === 0) {
      fx.bolt(dim, V.up(loc, 20), V.up(loc, 0.5), color, 1);
      sound(dim, "ambient.weather.lightning.impact", loc, 1, 0.6);
      shakeNear(dim, loc, 30, 0.25, 0.4);
    }
    if (t >= 60) {
      system.clearRun(id);
      try {
        dim.spawnEntity(type, loc);
      } catch {
        actionbar(player, "§cอัญเชิญล้มเหลว (พื้นที่ไม่ว่าง?)");
      }
    }
  }, 5);
}

// ---------- ลูปหลัก ----------
let beat = 0; // นับรอบ (ทุก 2 tick) ใช้แทน tick % n

function tickBosses() {
  const tick = system.currentTick;
  beat++;
  for (const [id, st] of bosses) {
    const e = st.entity;
    if (!alive(e)) {
      cleanup(st, false);
      bosses.delete(id);
      continue;
    }
    if (tick < st.introUntil) continue;
    if (beat % 10 === 0) {
      if (V.dist(e.location, st.home) > 22) {
        fx.implode(e.dimension, centerOf(e), COL.void, 3, 20);
        safe(() => e.teleport(st.home));
      }
      if (beat % 20 === 0) updateWaypoints(st);
    }
    try {
      if (st.type === "arc:ember_colossus") colossusAI(st, tick);
      else titanAI(st, tick);
    } catch (err) {
      console.warn(`[Arcane] boss AI: ${err}`);
    }
  }
}

export function initBosses() {
  world.afterEvents.entitySpawn.subscribe((ev) => {
    if (INFO[ev.entity.typeId] && alive(ev.entity)) registerBoss(ev.entity, true);
  });
  world.afterEvents.entityLoad.subscribe((ev) => {
    if (INFO[ev.entity.typeId] && alive(ev.entity)) registerBoss(ev.entity, false);
  });
  world.afterEvents.entityDie.subscribe((ev) => {
    const dead = ev.deadEntity;
    const st = bosses.get(dead.id);
    if (!st) return;
    let loc;
    let dim;
    try {
      loc = { ...dead.location };
      dim = dead.dimension;
    } catch {}
    cleanup(st, true);
    bosses.delete(dead.id);
    if (dim && loc) deathShow(st.type, dim, loc);
  });
  system.runInterval(tickBosses, 2);
}

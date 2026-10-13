import { system, EntityDamageCause } from "@minecraft/server";
import { SPELLS, STAFFS, ELEMENTS, ELEMENT_BONUS, ARCHMAGE_ALL_BONUS, ARMOR_SETS } from "./config.js";
import { getData, markDirty, worldSettings } from "./data.js";
import { spellDamage, enemiesNear, aoe, armorOf, frozen, canHit, isAlly } from "./combat.js";
import { launch } from "./projectiles.js";
import { fx, COL, sound, psound, shake, shakeNear, fade, pushFog, popFog } from "./fx.js";
import { addXp, questProgress } from "./progression.js";
import { trackSummon } from "./mobs.js";
import {
  V, alive, rand, pick, eyeOf, centerOf, actionbar, title, heal, safe, isCreative, getMainhand, setMainhand,
  playersNear, groundY, onCircle, fmt1,
} from "./util.js";

const cooldowns = new Map(); // player.id -> { spellId: tick ที่ใช้ได้อีกครั้ง }

export function cdLeft(player, spellId) {
  const c = cooldowns.get(player.id);
  return c ? Math.max(0, (c[spellId] ?? 0) - system.currentTick) : 0;
}

function setCd(player, spellId, ticks) {
  let c = cooldowns.get(player.id);
  if (!c) cooldowns.set(player.id, (c = {}));
  c[spellId] = system.currentTick + ticks;
}

export function resetCooldowns(player) {
  cooldowns.delete(player.id);
}

export const isStaff = (item) => !!item && item.typeId in STAFFS;

export function spellPower(player, d, spell, staffId) {
  const staff = STAFFS[staffId] ?? STAFFS["arc:apprentice_staff"];
  let p = (1 + 0.04 * d.attr.int + 0.02 * (d.lvl - 1)) * staff.power;
  if (staff.element === "all") p *= ARCHMAGE_ALL_BONUS;
  else if (staff.element && staff.element === spell.element) p *= ELEMENT_BONUS;
  p *= 1 + armorOf(player).archmage * ARMOR_SETS.archmage.powerPerPiece;
  return p;
}

export function manaCost(player, spellId, staffId) {
  const spell = SPELLS[spellId];
  const staff = STAFFS[staffId] ?? STAFFS["arc:apprentice_staff"];
  const sets = armorOf(player);
  if (spellId === "blink" && sets.voidplate >= 4) return 0;
  let cost = spell.mana * staff.mana;
  if (sets.archmage >= 4) cost *= 0.85;
  return Math.round(cost);
}

export function cooldownTicks(d, spellId) {
  return Math.round(SPELLS[spellId].cd * (1 - Math.min(40, d.attr.cel) / 100));
}

// ---------- ร่ายเวท ----------
export function tryCast(player, item) {
  const d = getData(player);
  const spellId = d.loadout[d.sel] ?? d.loadout.find(Boolean);
  if (!spellId || !SPELLS[spellId]) {
    actionbar(player, "§cยังไม่ได้ใส่คาถา §7— ย่อตัว + ใช้คทา เพื่อเลือกคาถา");
    return;
  }
  const spell = SPELLS[spellId];
  if (!d.known.includes(spellId)) {
    actionbar(player, `§cยังไม่ได้เรียน ${spell.name}`);
    return;
  }
  if (cdLeft(player, "_gcd") > 0) return;
  const left = cdLeft(player, spellId);
  if (left > 0) {
    actionbar(player, `§c${spell.name} §7คูลดาวน์ §f${fmt1(left / 20)} §7วินาที`);
    psound(player, "note.bass", 0.5, 0.7);
    return;
  }
  const creative = isCreative(player);
  const cost = manaCost(player, spellId, item.typeId);
  if (!creative && d.mana < cost) {
    actionbar(player, `§9มานาไม่พอ! §7ต้องการ §b${cost} §7มี §b${Math.floor(d.mana)}`);
    psound(player, "note.bass", 0.6, 0.5);
    return;
  }
  const ctx = {
    player, d, spell, spellId, dim: player.dimension,
    power: spellPower(player, d, spell, item.typeId),
    eye: eyeOf(player), dir: player.getViewDirection(), col: ELEMENTS[spell.element].rgb,
  };
  let ok;
  try {
    ok = CAST[spellId](ctx);
  } catch (err) {
    console.warn(`[Arcane] cast ${spellId}: ${err}`);
    ok = false;
  }
  if (ok === false) return;
  if (!creative) d.mana -= cost;
  setCd(player, spellId, cooldownTicks(d, spellId));
  setCd(player, "_gcd", 6);
  d.st.casts++;
  d.st.mana += cost;
  addXp(player, Math.max(1, Math.round(cost / 10)), true);
  questProgress(player, "cast");
  markDirty(player);
  fx.rune(ctx.dim, player.location, 1.3, ctx.col, 0.6, 180);
  sound(ctx.dim, "mob.evocation_illager.cast_spell", player.location, 0.35, 1.5);
  damageStaff(player, item);
}

function damageStaff(player, item) {
  if (isCreative(player)) return;
  const cur = getMainhand(player);
  if (!cur || cur.typeId !== item.typeId) return;
  const dur = cur.getComponent("minecraft:durability");
  if (!dur || dur.unbreakable) return;
  const unbreaking = safe(() => cur.getComponent("minecraft:enchantable")?.getEnchantment("unbreaking")?.level) ?? 0;
  if (Math.random() > 1 / (unbreaking + 1)) return;
  if (dur.damage + 1 >= dur.maxDurability) {
    setMainhand(player, undefined);
    psound(player, "random.break", 1, 1);
    return;
  }
  dur.damage += 1;
  setMainhand(player, cur);
}

// ---------- ตัวช่วยเล็ง ----------
function lookTarget(c, range = 24, cone = 0.9) {
  try {
    for (const hit of c.dim.getEntitiesFromRay(c.eye, c.dir, { maxDistance: range })) {
      if (canHit(c.player, hit.entity)) return hit.entity;
    }
  } catch {}
  let best;
  let bestScore = -9;
  for (const e of enemiesNear(c.player, c.dim, c.eye, range)) {
    const to = V.sub(centerOf(e), c.eye);
    const dot = V.dot(V.norm(to), c.dir);
    if (dot < cone) continue;
    const score = dot - (V.len(to) / range) * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

function lookPoint(c, range) {
  try {
    const hit = c.dim.getBlockFromRay(c.eye, c.dir, { maxDistance: range, includePassableBlocks: false, includeLiquidBlocks: true });
    if (hit) return V.add(hit.block.location, hit.faceLocation);
  } catch {}
  const p = V.add(c.eye, V.mul(c.dir, range));
  return { x: p.x, y: groundY(c.dim, p, 40), z: p.z };
}

const PASSABLE = /air|grass|flower|fern|snow_layer|torch|vine|carpet|button|rail|sapling|mushroom|sign|banner|lever|pressure_plate|tripwire|redstone_wire|deadbush|dead_bush|seagrass|kelp|tulip|poppy|dandelion|orchid|allium|azure|oxeye|cornflower|lily_of|rose|sugar_cane|bush|roots|sprouts|petals|leaf_litter|lichen|moss_carpet|candle|water/;

function passable(block) {
  if (!block) return false;
  return block.isAir || block.isLiquid || PASSABLE.test(block.typeId);
}

function isFree(dim, feet) {
  try {
    const b0 = dim.getBlock(V.floor(feet));
    const b1 = dim.getBlock(V.floor(V.up(feet, 1)));
    return passable(b0) && passable(b1);
  } catch {
    return false;
  }
}

// ---------- คาถาทั้ง 12 ----------
const CAST = {
  arcane_bolt(c) {
    const target = lookTarget(c, 28, 0.93);
    launch({
      dim: c.dim, pos: V.add(c.eye, V.mul(c.dir, 0.8)), vel: V.mul(c.dir, 1.4), owner: c.player,
      life: 30, radius: 0.55, homing: target ?? true, turn: 0.2, seek: 14,
      trail: (dim, pos) => {
        fx.orb(dim, pos, COL.arcane, 0.3, 0.3);
        fx.orb(dim, pos, COL.white, 0.12, 0.15);
      },
      onHitEntity: (e) => {
        spellDamage(e, 5 * c.power, c.player);
        fx.burst(c.dim, centerOf(e), COL.arcane, 10, 3);
        sound(c.dim, "random.orb", e.location, 0.4, 1.8);
      },
      onHitBlock: (pos) => fx.burst(c.dim, pos, COL.arcane, 8, 2),
    });
    sound(c.dim, "mob.shulker.shoot", c.eye, 0.6, 1.5);
  },

  fireball(c) {
    let done = false;
    const boom = (pos) => {
      if (done) return;
      done = true;
      fx.vanilla(c.dim, "minecraft:large_explosion", pos);
      fx.burst(c.dim, pos, COL.fire, 26, 6, 0.2);
      fx.ring(c.dim, V.up(pos, -0.5), 3.5, COL.fire, 0.5);
      fx.smoke(c.dim, pos, { red: 0.3, green: 0.15, blue: 0.08 }, 1, 10, 0.9);
      sound(c.dim, "random.explode", pos, 0.8, 1.25);
      aoe(c.player, c.dim, pos, 3.2, 9 * c.power, { fire: 4, knock: 0.6, lift: 0.35 });
    };
    launch({
      dim: c.dim, pos: V.add(c.eye, V.mul(c.dir, 0.8)), vel: V.mul(c.dir, 1.15), gravity: 0.012,
      owner: c.player, life: 50, radius: 0.6,
      trail: (dim, pos) => {
        fx.orb(dim, pos, COL.fire, 0.5, 0.3);
        fx.orb(dim, pos, COL.ember, 0.25, 0.2);
        if (Math.random() < 0.4) fx.vanilla(dim, "minecraft:basic_flame_particle", pos);
      },
      onHitEntity: (e, p) => {
        boom(p.pos);
        return true;
      },
      onHitBlock: boom,
      onExpire: boom,
    });
    sound(c.dim, "mob.blaze.shoot", c.eye, 0.8, 1);
  },

  frost_nova(c) {
    const loc = c.player.location;
    fx.ring(c.dim, loc, 7, COL.frost, 0.6);
    fx.ring(c.dim, V.up(loc, 0.6), 4.5, COL.white, 0.45);
    fx.shards(c.dim, V.up(loc, 1), COL.frost, 30, 8);
    for (let i = 0; i < 14; i++) fx.vanilla(c.dim, "minecraft:snowflake_particle", onCircle(loc, rand(1, 6.5), rand(0, Math.PI * 2), rand(0.2, 1.6)));
    sound(c.dim, "random.glass", loc, 1, 0.7);
    sound(c.dim, "mob.player.hurt_freeze", loc, 1, 0.8);
    const hit = aoe(c.player, c.dim, V.up(loc, 1), 7, 6 * c.power, { minFrac: 0.7, knock: 0.5, lift: 0.25, effect: ["slowness", 80, 3] });
    for (const e of hit) {
      safe(() => e.addEffect("weakness", 80, { amplifier: 1 }));
      fx.shards(c.dim, centerOf(e), COL.frost, 6, 2);
    }
  },

  blink(c) {
    const p = c.player;
    const from = { ...p.location };
    let max = 12;
    try {
      const hit = c.dim.getBlockFromRay(c.eye, c.dir, { maxDistance: 12, includePassableBlocks: false, includeLiquidBlocks: false });
      if (hit) max = Math.max(0, V.dist(c.eye, V.add(hit.block.location, hit.faceLocation)) - 0.7);
    } catch {}
    let dest;
    for (let d = max; d >= 1; d -= 0.5) {
      const eye = V.add(c.eye, V.mul(c.dir, d));
      const feet = { x: eye.x, y: eye.y - 1.62, z: eye.z };
      if (isFree(c.dim, feet)) {
        dest = feet;
        break;
      }
    }
    if (!dest) {
      actionbar(p, "§cไม่มีที่ว่างพอให้วาร์ป");
      return false;
    }
    fx.implode(c.dim, V.up(from, 1), COL.arcane, 1.5, 16);
    fx.smoke(c.dim, V.up(from, 1), { red: 0.4, green: 0.2, blue: 0.6 }, 0.5, 6);
    fx.line(c.dim, V.up(from, 1), V.up(dest, 1), COL.arcane, 0.7, 0.18, 0.4);
    p.teleport(dest, { keepVelocity: false, rotation: p.getRotation() });
    fx.burst(c.dim, V.up(dest, 1), COL.arcane, 16, 4);
    sound(c.dim, "mob.endermen.portal", dest, 0.8, 1.3);
    safe(() => p.addEffect("slow_falling", 30, { amplifier: 0, showParticles: false }));
  },

  chain_lightning(c) {
    const first = lookTarget(c, 24, 0.88);
    if (!first) {
      actionbar(c.player, "§eไม่มีเป้าหมายในสายตา");
      return false;
    }
    const chain = [first];
    const hitIds = new Set([first.id]);
    const jumps = 4 + Math.floor(c.power);
    let cur = first;
    for (let i = 0; i < jumps; i++) {
      let next;
      let bestD = 9;
      for (const e of enemiesNear(c.player, c.dim, centerOf(cur), 8)) {
        if (hitIds.has(e.id)) continue;
        const d = V.dist(centerOf(e), centerOf(cur));
        if (d < bestD) {
          bestD = d;
          next = e;
        }
      }
      if (!next) break;
      hitIds.add(next.id);
      chain.push(next);
      cur = next;
    }
    let prev = V.add(c.eye, V.mul(c.dir, 0.6));
    chain.forEach((e, i) => {
      system.runTimeout(() => {
        if (!alive(e)) return;
        const to = centerOf(e);
        fx.bolt(c.dim, prev, to, COL.storm, 0.5);
        fx.burst(c.dim, to, COL.storm, 10, 4, 0.12);
        sound(c.dim, "ambient.weather.lightning.impact", to, 0.45, 1.6);
        spellDamage(e, 10 * c.power * Math.pow(0.85, i), c.player, EntityDamageCause.lightning);
        prev = to;
      }, i * 2);
    });
  },

  healing_circle(c) {
    const center = { ...c.player.location };
    const dim = c.dim;
    const power = c.power;
    sound(dim, "beacon.power", center, 1, 1.4);
    fx.rune(dim, center, 5, COL.nature, 1.05, 30);
    let t = 0;
    const id = system.runInterval(() => {
      t += 10;
      if (t > 160) {
        system.clearRun(id);
        sound(dim, "beacon.deactivate", center, 0.6, 1.4);
        return;
      }
      fx.rise(dim, center, COL.nature, 4.5, 10, 1.5, 0.15);
      if (t % 20 !== 0) return;
      fx.rune(dim, center, 5, COL.nature, 1.05, 30);
      let ents = [];
      try {
        ents = dim.getEntities({ location: center, maxDistance: 5.5 });
      } catch {}
      for (const e of ents) {
        if (!isAlly(e)) continue;
        if (heal(e, 2 * power) > 0) fx.rise(dim, e.location, COL.nature, 0.4, 5, 2, 0.12);
        safe(() => e.addEffect("regeneration", 30, { amplifier: 0, showParticles: false }));
      }
      sound(dim, "random.orb", center, 0.5, 1.7);
    }, 10);
  },

  spirit_wolves(c) {
    const n = c.power >= 2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const loc = onCircle(c.player.location, 1.8, (i / n) * Math.PI * 2, 0.2);
      let w;
      try {
        w = c.dim.spawnEntity("arc:spirit_wolf", loc);
      } catch {
        continue;
      }
      safe(() => w.getComponent("minecraft:tameable")?.tame(c.player));
      safe(() => w.setDynamicProperty("arc:owner", c.player.id));
      if (c.power >= 1.5) safe(() => w.addEffect("strength", 820, { amplifier: Math.min(3, Math.floor(c.power) - 1), showParticles: false }));
      trackSummon(w, c.player, 800);
      fx.rise(c.dim, loc, COL.frost, 0.8, 18, 2.5);
      fx.swirl(c.dim, V.up(loc, 0.5), COL.white, 1.2, 10);
    }
    sound(c.dim, "mob.wolf.growl", c.player.location, 1, 1.3);
    sound(c.dim, "mob.allay.idle", c.player.location, 0.8, 0.8);
  },

  meteor(c) {
    const target = lookPoint(c, 40);
    const dim = c.dim;
    fx.rune(dim, target, 5, COL.fire, 1.6, 120);
    sound(dim, "mob.blaze.breathe", target, 1, 0.6);
    let warn = 0;
    const wid = system.runInterval(() => {
      fx.circle(dim, target, 5, COL.red, 28, 0.2, 0.3);
      if (++warn > 6) system.clearRun(wid);
    }, 5);
    const sky = { x: target.x - 8, y: target.y + 30, z: target.z - 8 };
    const vel = V.mul(V.sub(target, sky), 1 / 28);
    let done = false;
    const impact = (pos) => {
      if (done) return;
      done = true;
      fx.vanilla(dim, "minecraft:huge_explosion_emitter", pos);
      fx.ring(dim, pos, 6, COL.fire, 0.7);
      fx.ring(dim, pos, 3, COL.white, 0.4);
      fx.shards(dim, V.up(pos, 0.5), COL.rock, 30, 9, 0.22);
      fx.burst(dim, V.up(pos, 0.5), COL.fire, 40, 9, 0.25);
      fx.smoke(dim, V.up(pos, 1), { red: 0.2, green: 0.12, blue: 0.08 }, 2.5, 16, 1.4);
      sound(dim, "random.explode", pos, 2, 0.7);
      shakeNear(dim, pos, 28, 0.6, 0.8);
      aoe(c.player, dim, V.up(pos, 1), 5, 22 * c.power, { fire: 5, knock: 1.0, lift: 0.7, minFrac: 0.4 });
    };
    launch({
      dim, pos: sky, vel, owner: c.player, life: 40, radius: 1.2,
      trail: (d, pos) => {
        fx.orb(d, pos, COL.fire, 1.3, 0.5);
        fx.orb(d, pos, COL.ember, 0.7, 0.4);
        fx.smoke(d, pos, { red: 0.15, green: 0.1, blue: 0.08 }, 0.5, 2, 1.2);
        fx.vanilla(d, "minecraft:lava_particle", pos);
      },
      onHitEntity: (e, p) => {
        impact(p.pos);
        return true;
      },
      onHitBlock: impact,
      onExpire: impact,
    });
  },

  black_hole(c) {
    const center = V.up(lookPoint(c, 20), 1.5);
    const dim = c.dim;
    sound(dim, "mob.endermen.portal", center, 1, 0.4);
    let t = 0;
    const id = system.runInterval(() => {
      t += 2;
      if (t >= 80) {
        system.clearRun(id);
        fx.vanilla(dim, "minecraft:sonic_explosion", center);
        fx.burst(dim, center, COL.void, 50, 9, 0.22);
        fx.ring(dim, V.up(center, -1.4), 6, COL.void, 0.6);
        sound(dim, "mob.warden.sonic_boom", center, 1, 0.9);
        shakeNear(dim, center, 20, 0.4, 0.5);
        aoe(c.player, dim, center, 5.5, 14 * c.power, { knock: 1.2, lift: 0.5 });
        return;
      }
      fx.orb(dim, center, COL.voidDark, 1.1, 0.15);
      fx.orb(dim, center, { red: 0.05, green: 0, blue: 0.08 }, 0.7, 0.15);
      fx.swirl(dim, V.up(center, -0.6), COL.void, 4.5, 6, 0.2);
      if (t % 10 === 0) {
        fx.implode(dim, center, COL.void, 7, 24, 0.22);
        sound(dim, "mob.warden.heartbeat", center, 0.6, 1.6);
      }
      for (const e of enemiesNear(c.player, dim, center, 9.5)) {
        if (safe(() => e.matches({ families: ["arc_boss"] }))) continue;
        const to = V.sub(center, centerOf(e));
        const d = V.len(to);
        if (d < 0.8) {
          safe(() => e.clearVelocity());
        } else {
          const pull = V.mul(V.norm(to), Math.min(0.32, 0.07 + d * 0.025));
          if (e.typeId === "minecraft:player") safe(() => e.applyKnockback({ x: pull.x * 2, z: pull.z * 2 }, pull.y + 0.05));
          else safe(() => e.applyImpulse(pull));
        }
        if (t % 10 === 0) spellDamage(e, 2 * c.power, c.player);
      }
    }, 2);
  },

  storm_call(c) {
    const caster = c.player;
    const real = worldSettings().realLightning;
    sound(c.dim, "ambient.weather.thunder", caster.location, 1, 1);
    fx.ring(c.dim, caster.location, 14, COL.storm, 0.8);
    let t = 0;
    const id = system.runInterval(() => {
      t += 10;
      if (!alive(caster) || t > 120) {
        system.clearRun(id);
        return;
      }
      const dim = caster.dimension;
      const center = caster.location;
      const strikes = c.power >= 1.6 ? 2 : 1;
      const foes = enemiesNear(caster, dim, center, 14);
      for (let s = 0; s < strikes; s++) {
        if (!foes.length) {
          const p = onCircle(center, rand(3, 12), rand(0, Math.PI * 2));
          const g = { x: p.x, y: groundY(dim, V.up(p, 8), 20), z: p.z };
          fx.bolt(dim, V.up(g, 14), g, COL.storm, 1.2);
          fx.ring(dim, g, 1.5, COL.storm, 0.4);
          break;
        }
        const e = pick(foes);
        const to = centerOf(e);
        fx.bolt(dim, V.up(e.location, 14), to, COL.storm, 1.2);
        fx.bolt(dim, V.up(e.location, 14), to, COL.white, 0.9);
        fx.ring(dim, e.location, 2, COL.storm, 0.4);
        sound(dim, "ambient.weather.lightning.impact", to, 0.9, 1);
        spellDamage(e, 12 * c.power, caster, EntityDamageCause.lightning);
        if (real && !playersNear(dim, e.location, 4, true).length) safe(() => dim.spawnEntity("minecraft:lightning_bolt", e.location));
      }
    }, 10);
  },

  time_stop(c) {
    const caster = c.player;
    const dim = c.dim;
    const center = { ...caster.location };
    const until = system.currentTick + 120;
    let n = 0;
    for (const e of enemiesNear(caster, dim, center, 16, 40)) {
      if (frozen.has(e.id)) continue;
      frozen.set(e.id, { entity: e, loc: { ...e.location }, rot: e.getRotation(), acc: 0, attacker: caster, until });
      safe(() => e.addEffect("slowness", 130, { amplifier: 255, showParticles: false }));
      safe(() => e.addEffect("weakness", 130, { amplifier: 255, showParticles: false }));
      n++;
    }
    const viewers = playersNear(dim, center, 24, true);
    for (const p of viewers) {
      pushFog(p, "arc:time_stop", "arc_ts");
      fade(p, { red: 0.85, green: 0.9, blue: 1 }, 0.05, 0.05, 0.4);
    }
    fx.ring(dim, center, 16, COL.white, 1.0);
    fx.rune(dim, center, 6, COL.frost, 6, 0);
    sound(dim, "block.bell.hit", center, 1.2, 0.5);
    title(caster, "§b§lหยุดเวลา!", `§7หยุด ${n} เป้าหมาย 6 วินาที`, 2, 30, 10);
    system.runTimeout(() => {
      for (const p of viewers) if (alive(p)) popFog(p, "arc_ts");
      sound(dim, "block.bell.hit", center, 1.2, 1.2);
    }, 120);
  },

  cataclysm(c) {
    const caster = c.player;
    const dim = c.dim;
    const origin = { ...caster.location };
    safe(() => caster.addEffect("levitation", 30, { amplifier: 0, showParticles: false }));
    const viewers = playersNear(dim, origin, 40, true);
    for (const p of viewers) pushFog(p, "arc:cataclysm", "arc_cata");
    sound(dim, "mob.wither.spawn", origin, 0.7, 1.4);
    title(caster, "§d§lมหาวิบัติอาร์เคน", "§7...", 2, 40, 10);
    let t = 0;
    const id = system.runInterval(() => {
      t += 2;
      if (!alive(caster)) {
        system.clearRun(id);
        for (const p of viewers) if (alive(p)) popFog(p, "arc_cata");
        return;
      }
      if (t <= 50) {
        if (t % 6 === 0) fx.rune(dim, origin, 3 + (t / 50) * 9, COL.arcane, 0.6, 120);
        fx.swirl(dim, V.up(caster.location, 1), COL.pink, 3, 6);
        if (t % 10 === 0) shakeNear(dim, origin, 30, 0.15, 0.4);
        return;
      }
      const i = (t - 52) / 2;
      if (i >= 0 && i < 16) {
        const p = onCircle(origin, 3 + i * 0.75, i * 2.39996);
        const ground = { x: p.x, y: groundY(dim, V.up(p, 6), 16), z: p.z };
        fx.line(dim, V.up(ground, 24), ground, COL.pink, 0.8, 0.45, 0.4);
        fx.ring(dim, ground, 3.5, COL.arcane, 0.5);
        fx.burst(dim, V.up(ground, 0.5), COL.pink, 16, 6);
        sound(dim, "random.explode", ground, 0.5, 1.6);
        aoe(caster, dim, V.up(ground, 1), 3.5, 18 * c.power, { knock: 0.5, lift: 0.8, minFrac: 0.6 });
      } else if (i >= 16) {
        system.clearRun(id);
        for (const p of playersNear(dim, origin, 40, true)) {
          fade(p, { red: 1, green: 0.9, blue: 1 }, 0.1, 0.1, 0.7);
          shake(p, 0.8, 1);
        }
        fx.vanilla(dim, "minecraft:huge_explosion_emitter", V.up(origin, 1));
        fx.ring(dim, origin, 9, COL.white, 0.8);
        fx.burst(dim, V.up(origin, 1), COL.arcane, 60, 10, 0.25);
        sound(dim, "random.explode", origin, 2, 0.6);
        aoe(caster, dim, V.up(origin, 1), 8, 25 * c.power, { knock: 1.5, lift: 0.8 });
        safe(() => caster.addEffect("slow_falling", 100, { amplifier: 0, showParticles: false }));
        system.runTimeout(() => {
          for (const p of viewers) if (alive(p)) popFog(p, "arc_cata");
        }, 60);
      }
    }, 2);
  },
};

// ---------- หยุดเวลา: ตรึงทุก tick ----------
function tickFrozen() {
  const tick = system.currentTick;
  for (const [id, f] of frozen) {
    if (!alive(f.entity)) {
      frozen.delete(id);
      continue;
    }
    if (tick >= f.until) {
      frozen.delete(id);
      safe(() => f.entity.removeEffect("slowness"));
      safe(() => f.entity.removeEffect("weakness"));
      if (f.acc > 0) {
        const at = centerOf(f.entity);
        fx.burst(f.entity.dimension, at, COL.white, 18, 5);
        fx.ring(f.entity.dimension, f.entity.location, 1.5, COL.frost, 0.4);
        spellDamage(f.entity, f.acc * 1.5, alive(f.attacker) ? f.attacker : undefined);
      }
      continue;
    }
    safe(() => f.entity.teleport(f.loc, { rotation: f.rot, keepVelocity: false }));
    safe(() => f.entity.clearVelocity());
    if (tick % 20 === 0) fx.orb(f.entity.dimension, V.up(f.loc, 2.2), COL.frost, 0.25, 1);
  }
}

export function initSpells() {
  system.runInterval(tickFrozen, 1);
}


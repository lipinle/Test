import { MolangVariableMap, CameraShakeType, world } from "@minecraft/server";
import { getData } from "./data.js";
import { V, rand, playersNear } from "./util.js";

// สีสำเร็จรูป (0..1)
export const COL = {
  arcane: { red: 0.72, green: 0.45, blue: 1 },
  fire: { red: 1, green: 0.45, blue: 0.1 },
  ember: { red: 1, green: 0.75, blue: 0.25 },
  frost: { red: 0.55, green: 0.92, blue: 1 },
  storm: { red: 1, green: 0.92, blue: 0.35 },
  void: { red: 0.75, green: 0.2, blue: 1 },
  voidDark: { red: 0.25, green: 0.05, blue: 0.4 },
  nature: { red: 0.4, green: 1, blue: 0.5 },
  white: { red: 1, green: 1, blue: 1 },
  gold: { red: 1, green: 0.82, blue: 0.3 },
  red: { red: 1, green: 0.15, blue: 0.2 },
  pink: { red: 1, green: 0.45, blue: 0.9 },
  rock: { red: 0.45, green: 0.32, blue: 0.25 },
};

function vars(color, extra) {
  const m = new MolangVariableMap();
  m.setColorRGB("variable.color", color ?? COL.white);
  if (extra) for (const k in extra) m.setFloat(`variable.${k}`, extra[k]);
  return m;
}

function spawn(dim, id, loc, m) {
  try {
    dim.spawnParticle(id, loc, m);
  } catch {}
}

export const fx = {
  orb(dim, loc, color, size = 0.25, life = 0.35) {
    spawn(dim, "arc:orb", loc, vars(color, { size, life }));
  },
  burst(dim, loc, color, count = 12, speed = 4, size = 0.15) {
    spawn(dim, "arc:burst", loc, vars(color, { count, speed, size }));
  },
  ring(dim, loc, radius, color, life = 0.5) {
    spawn(dim, "arc:ring", V.up(loc, 0.08), vars(color, { radius, life }));
  },
  rune(dim, loc, radius, color, life = 1.5, spin = 45) {
    spawn(dim, "arc:rune_circle", V.up(loc, 0.06), vars(color, { radius, life, spin }));
  },
  rise(dim, loc, color, radius = 1, count = 16, speed = 2, size = 0.15) {
    spawn(dim, "arc:rise", loc, vars(color, { radius, count, speed, size }));
  },
  implode(dim, loc, color, radius = 3, count = 20, size = 0.2) {
    spawn(dim, "arc:implode", loc, vars(color, { radius, count, size }));
  },
  shards(dim, loc, color, count = 14, speed = 5, size = 0.14) {
    spawn(dim, "arc:shards", loc, vars(color, { count, speed, size }));
  },
  smoke(dim, loc, color, radius = 0.6, count = 8, size = 0.6) {
    spawn(dim, "arc:smoke", loc, vars(color ?? { red: 0.2, green: 0.1, blue: 0.3 }, { radius, count, size }));
  },
  swirl(dim, loc, color, radius = 2, count = 10, size = 0.18) {
    spawn(dim, "arc:swirl", loc, vars(color, { radius, count, size }));
  },
  vanilla(dim, id, loc) {
    spawn(dim, id, loc, undefined);
  },
  /** เส้นตรงของลูกแสง */
  line(dim, a, b, color, step = 0.45, size = 0.2, life = 0.3) {
    const d = V.dist(a, b);
    const n = Math.min(80, Math.max(1, Math.ceil(d / step)));
    for (let i = 0; i <= n; i++) fx.orb(dim, V.lerp(a, b, i / n), color, size, life);
  },
  /** สายฟ้าหยัก ๆ */
  bolt(dim, a, b, color = COL.storm, jag = 0.6) {
    const d = V.dist(a, b);
    const segs = Math.max(2, Math.min(10, Math.round(d / 1.5)));
    let prev = a;
    for (let i = 1; i <= segs; i++) {
      let p = V.lerp(a, b, i / segs);
      if (i < segs) p = { x: p.x + rand(-jag, jag), y: p.y + rand(-jag, jag), z: p.z + rand(-jag, jag) };
      fx.line(dim, prev, p, color, 0.35, 0.16, 0.25);
      prev = p;
    }
    fx.vanilla(dim, "minecraft:electric_spark_particle", b);
  },
  /** วงกลมจุด ๆ (ใช้บอกตำแหน่งอันตราย) */
  circle(dim, loc, radius, color, points = 24, size = 0.2, life = 0.4) {
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2;
      fx.orb(dim, { x: loc.x + Math.cos(a) * radius, y: loc.y + 0.15, z: loc.z + Math.sin(a) * radius }, color, size, life);
    }
  },
};

export function sound(dim, id, loc, volume = 1, pitch = 1) {
  try {
    dim.playSound(id, loc, { volume, pitch });
  } catch {}
}

export function psound(player, id, volume = 1, pitch = 1) {
  try {
    player.playSound(id, { volume, pitch });
  } catch {}
}

// ---------- กล้อง ----------
export function shake(player, intensity = 0.4, seconds = 0.5) {
  try {
    if (!getData(player).set.shake) return;
    player.camera.addShake({ intensity, duration: seconds, type: CameraShakeType.Positional });
  } catch {
    try {
      player.runCommand(`camerashake add @s ${intensity} ${seconds} positional`);
    } catch {}
  }
}

export function shakeNear(dim, loc, radius, intensity = 0.4, seconds = 0.5) {
  for (const p of playersNear(dim, loc, radius, true)) {
    const k = 1 - V.dist(p.location, loc) / radius;
    shake(p, Math.max(0.05, intensity * k), seconds);
  }
}

export function fade(player, color = { red: 0, green: 0, blue: 0 }, fadeIn = 0.3, hold = 0.3, fadeOut = 0.6) {
  try {
    player.camera.fade({ fadeColor: color, fadeTime: { fadeInTime: fadeIn, holdTime: hold, fadeOutTime: fadeOut } });
  } catch {}
}

const fogged = new Set(); // "playerId|tag" ที่ใส่หมอกไว้แล้ว (กันใส่ซ้ำทุกรอบ)

export function pushFog(player, fogId, tag) {
  const k = `${player.id}|${tag}`;
  if (fogged.has(k)) return;
  fogged.add(k);
  try {
    player.fogSettings.remove(tag);
    player.fogSettings.push(fogId, tag);
  } catch {
    try {
      player.runCommand(`fog @s remove ${tag}`);
      player.runCommand(`fog @s push ${fogId} ${tag}`);
    } catch {}
  }
}

export function popFog(player, tag) {
  fogged.delete(`${player.id}|${tag}`);
  try {
    player.fogSettings.remove(tag);
  } catch {
    try {
      player.runCommand(`fog @s remove ${tag}`);
    } catch {}
  }
}

/** เรียกตอนผู้เล่นเข้าเกม/เกิดใหม่ ให้ใส่หมอกใหม่ได้ */
export function forgetFog(player) {
  for (const k of [...fogged]) if (k.startsWith(`${player.id}|`)) fogged.delete(k);
}

export function allPlayers() {
  return world.getAllPlayers();
}

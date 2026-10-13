import { system } from "@minecraft/server";
import { PROJECTILE_MAX } from "./config.js";
import { canHit } from "./combat.js";
import { fx } from "./fx.js";
import { V, alive, centerOf, distToBox } from "./util.js";

// ลูกเวทแบบสคริปต์: ไม่ใช้ entity เลย เคลื่อนที่ด้วยคณิตศาสตร์ + วาดด้วย particle
// opts: { dim, pos, vel, owner, life, radius, gravity, homing, turn, color, size, trail(dim,pos,p),
//         onHitEntity(e,p) -> true = หยุด, onHitBlock(pos,p), onExpire(pos,p), pierce, ignoreBlocks }
const active = [];

export function launch(opts) {
  if (active.length >= PROJECTILE_MAX) active.shift();
  const p = {
    life: 60,
    radius: 0.4,
    gravity: 0,
    turn: 0.12,
    size: 0.3,
    pierce: 0,
    age: 0,
    hits: new Set(),
    ...opts,
  };
  // เก็บข้อมูลเจ้าของไว้ เผื่อเจ้าของตาย/หายไปกลางทาง (entity ที่หายแล้วอ่านค่าไม่ได้)
  p.ownerRef = opts.owner ? { id: opts.owner.id, typeId: opts.owner.typeId } : undefined;
  active.push(p);
  return p;
}

const ownerOf = (p) => (p.owner && alive(p.owner) ? p.owner : p.ownerRef);

function nearestTarget(p) {
  let best;
  let bestD = 1e9;
  try {
    for (const e of p.dim.getEntities({ location: p.pos, maxDistance: p.seek ?? 12 })) {
      if (p.hits.has(e.id) || !canHit(ownerOf(p), e)) continue;
      const to = V.sub(centerOf(e), p.pos);
      const d = V.len(to);
      if (V.dot(V.norm(to), V.norm(p.vel)) < 0.55) continue; // ต้องอยู่ข้างหน้า
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
  } catch {}
  return best;
}

function step(p) {
  p.age++;
  if (p.homing) {
    if (p.homing === true || !alive(p.homing)) p.homing = p.age % 4 === 1 ? nearestTarget(p) ?? true : p.homing;
    if (p.homing !== true && alive(p.homing)) {
      const speed = V.len(p.vel);
      const want = V.mul(V.norm(V.sub(centerOf(p.homing), p.pos)), speed);
      p.vel = V.mul(V.norm(V.lerp(p.vel, want, p.turn)), speed);
    }
  }
  p.vel.y -= p.gravity;
  const speed = V.len(p.vel);
  const n = Math.max(1, Math.ceil(speed / 0.5));
  const segLen = speed / n;
  const dir = V.norm(p.vel);
  for (let i = 0; i < n; i++) {
    if (!p.ignoreBlocks) {
      let hit;
      try {
        hit = p.dim.getBlockFromRay(p.pos, dir, { maxDistance: segLen + 0.05, includeLiquidBlocks: false, includePassableBlocks: false });
      } catch {
        return false;
      }
      if (hit) {
        const at = V.add(hit.block.location, hit.faceLocation);
        p.onHitBlock?.(at, p);
        return false;
      }
    }
    p.pos = V.add(p.pos, V.mul(dir, segLen));
    let ents = [];
    try {
      ents = p.dim.getEntities({ location: p.pos, maxDistance: p.radius + 3 });
    } catch {
      return false;
    }
    for (const e of ents) {
      if (p.hits.has(e.id) || (p.ownerRef && e.id === p.ownerRef.id)) continue;
      if (!canHit(ownerOf(p), e)) continue;
      if (distToBox(p.pos, e) > p.radius) continue;
      p.hits.add(e.id);
      const stop = p.onHitEntity ? p.onHitEntity(e, p) !== false : true;
      if (stop) {
        if (p.pierce <= 0) return false;
        p.pierce--;
      }
    }
  }
  if (p.trail) p.trail(p.dim, p.pos, p);
  else fx.orb(p.dim, p.pos, p.color, p.size, 0.25);
  if (p.age >= p.life) {
    p.onExpire?.(p.pos, p);
    return false;
  }
  return true;
}

export function tickProjectiles() {
  for (let i = active.length - 1; i >= 0; i--) {
    let keep = false;
    try {
      keep = step(active[i]);
    } catch (err) {
      console.warn(`[Arcane] projectile: ${err}`);
    }
    if (!keep) active.splice(i, 1);
  }
}

export function initProjectiles() {
  system.runInterval(tickProjectiles, 1);
}

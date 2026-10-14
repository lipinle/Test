import { world, system, BlockVolume, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { RIFT_TIERS, RIFT_LOOT, RIFT_COLLAPSE_SECONDS, RIFT_ABANDON_SECONDS } from "./config.js";
import { getData, saveData, getWorld, setWorld, worldSettings, saveWorldSettings } from "./data.js";
import { addXp, addMana, questProgress } from "./progression.js";
import { fx, COL, sound, psound, fade, pushFog, popFog, shakeNear } from "./fx.js";
import {
  V, alive, rand, randInt, pick, weightedPick, safe, title, tell, actionbar, consumeItem, isCreative, roman, heal, showForm,
} from "./util.js";

// ============================================================================
//  รอยแยกมิติ: ดันเจี้ยนสุ่มสร้างในมิติใหม่ "arc:the_rift" (ถ้าใช้ไม่ได้จะสร้างบนฟ้าแทน)
//  ผัง: ห้อง 4x4 (ห้องละ 11x11) เชื่อมกันแบบเขาวงกต + ทางเดิน + ลานบอสทรงกลม
// ============================================================================
const CELL = 12;
const GRID = 4;
const SIZE = GRID * CELL; // 48
const ROOM_H = 7;
const CORR = 9;
const ARENA_R = 14;
const ARENA_CX = SIZE + CORR + ARENA_R + 1; // ระยะ x ของศูนย์กลางลานบอส (นับจาก origin)
const MAX_RIFTS = 4;

const T = {
  floor: "arc:rift_tiles",
  wall: "arc:rift_bricks",
  lamp: "arc:void_lamp",
  barrier: "arc:rift_barrier",
  crystal: "arc:arcane_crystal_block",
  air: "minecraft:air",
  cry: "minecraft:crying_obsidian",
  ame: "minecraft:amethyst_block",
  cluster: "minecraft:amethyst_cluster",
};

let riftDim; // Dimension ของมิติใหม่ (ถ้าลงทะเบียนสำเร็จ)
const runtime = new Map(); // rift id -> runtime state

export function setRiftDimension(dim) {
  riftDim = dim;
}

export function riftDimension() {
  return riftDim;
}

function records() {
  return getWorld("arc:rifts", []);
}

function saveRecords() {
  setWorld("arc:rifts", [...runtime.values()].map((rt) => rt.rec));
}

// ---------- ผังดันเจี้ยน ----------
function genLayout() {
  const cells = [];
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) cells.push({ x, z, links: new Set(), type: "combat", started: false, cleared: false, wave: 0, checkAfter: 0, startedAt: 0 });
  const idx = (x, z) => z * GRID + x;
  const nb = (c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [c.x + dx, c.z + dz]).filter(([x, z]) => x >= 0 && z >= 0 && x < GRID && z < GRID).map(([x, z]) => idx(x, z));
  const start = idx(0, randInt(0, GRID - 1));
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const opts = nb(cells[cur]).filter((n) => !seen.has(n));
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const n = pick(opts);
    cells[cur].links.add(n);
    cells[n].links.add(cur);
    seen.add(n);
    stack.push(n);
  }
  for (let k = 0; k < 3; k++) {
    const a = randInt(0, cells.length - 1);
    const b = pick(nb(cells[a]));
    cells[a].links.add(b);
    cells[b].links.add(a);
  }
  const dist = new Map([[start, 0]]);
  const q = [start];
  while (q.length) {
    const c = q.shift();
    for (const n of cells[c].links) if (!dist.has(n)) {
      dist.set(n, dist.get(c) + 1);
      q.push(n);
    }
  }
  let exit = idx(GRID - 1, 0);
  for (let z = 0; z < GRID; z++) if ((dist.get(idx(GRID - 1, z)) ?? 0) > (dist.get(exit) ?? 0)) exit = idx(GRID - 1, z);
  cells[start].type = "start";
  const free = cells.map((c, i) => i).filter((i) => i !== start && i !== exit);
  const deadEnds = free.filter((i) => cells[i].links.size === 1).sort(() => Math.random() - 0.5);
  const others = free.filter((i) => !deadEnds.includes(i)).sort(() => Math.random() - 0.5);
  const order = [...deadEnds, ...others];
  cells[order[0]].type = "treasure";
  cells[order[1]].type = "treasure";
  cells[order[2]].type = "shrine";
  return { cells, start, exit };
}

// ---------- รายการคำสั่งสร้าง (ทำทีละขั้นด้วย runJob) ----------
function box(a, b) {
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
  };
}

// ---------- ระบบสร้างแบบแบ่งตาม chunk ----------
// แต่ละ chunk มีคิวคำสั่งของตัวเอง และทำตามลำดับเสมอ (ล้าง → พื้น → กำแพง → ประตู → ของตกแต่ง)
// ไม่พึ่ง isChunkLoaded: ลองวางเลย ถ้า chunk ยังไม่โหลดเกมจะ throw แล้วรอบหน้าค่อยลองใหม่
// chunk ที่โหลดแล้ว (เช่นรอบตัวผู้เล่น) จะสร้างเสร็จก่อนโดยไม่ต้องรอ chunk ไกล ๆ
function queueOf(plan, x, z) {
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  const key = `${cx},${cz}`;
  let q = plan.get(key);
  if (!q) plan.set(key, (q = { key, cx, cz, ops: [], i: 0, done: false, fails: 0 }));
  return q;
}

function fillOp(plan, a, b, block) {
  const bx = box(a, b);
  for (let cx = Math.floor(bx.min.x / 16); cx <= Math.floor(bx.max.x / 16); cx++) {
    for (let cz = Math.floor(bx.min.z / 16); cz <= Math.floor(bx.max.z / 16); cz++) {
      const min = { x: Math.max(bx.min.x, cx * 16), y: bx.min.y, z: Math.max(bx.min.z, cz * 16) };
      const max = { x: Math.min(bx.max.x, cx * 16 + 15), y: bx.max.y, z: Math.min(bx.max.z, cz * 16 + 15) };
      queueOf(plan, min.x, min.z).ops.push({ min, max, block });
    }
  }
}

function setOp(plan, p, block) {
  fillOp(plan, p, p, block);
}

function customOp(plan, p, run) {
  queueOf(plan, p.x, p.z).ops.push({ min: p, max: p, run });
}

function runOp(dim, op) {
  if (op.run) return op.run(dim);
  if (op.min.x === op.max.x && op.min.y === op.max.y && op.min.z === op.max.z) return dim.setBlockType(op.min, op.block);
  return dim.fillBlocks(new BlockVolume(op.min, op.max), op.block);
}

/** ทำคำสั่งในคิวตามลำดับ คืนจำนวนคำสั่งที่สำเร็จ (budget = จำนวนสูงสุดรอบนี้) */
function buildStep(rt, queues, budget, nearPlayers = []) {
  let did = 0;
  for (const q of queues) {
    if (q.done) continue;
    while (q.i < q.ops.length && did < budget) {
      try {
        runOp(rt.dim, q.ops[q.i]);
      } catch (err) {
        q.fails++;
        if (!rt.loggedError) {
          rt.loggedError = true;
          console.warn(`[Arcane] rift build waiting for chunk ${q.key}: ${err}`);
        }
        // มีผู้เล่นยืนอยู่ใกล้ chunk นี้แต่ยังวางไม่ได้ซ้ำ ๆ -> ข้ามคำสั่งนี้ไป ไม่ให้คิวค้างตลอดกาล
        const near = nearPlayers.some((p) => alive(p) && Math.abs(Math.floor(p.location.x / 16) - q.cx) <= 1 && Math.abs(Math.floor(p.location.z / 16) - q.cz) <= 1);
        if (near && q.fails > 30) {
          q.i++;
          q.fails = 0;
        }
        break;
      }
      q.i++;
      did++;
    }
    if (q.i >= q.ops.length) q.done = true;
    if (did >= budget) break;
  }
  return did;
}

function* buildJob(rt) {
  for (let pass = 0; pass < 2; pass++) {
    let progress = 0;
    for (const q of rt.queues) {
      while (!q.done && !rt.collapsing) {
        const n = buildStep(rt, [q], 3);
        progress += n;
        if (!n) break;
        yield;
      }
    }
    if (!progress) break;
  }
  rt.firstPassDone = true;
}

const allBuilt = (rt) => !!rt.queues && rt.queues.every((q) => q.done);
const startBuilt = (rt) => !!rt.startQueues && rt.startQueues.every((q) => q.done);

function cellBox(rt, c) {
  const o = rt.origin;
  return { x0: o.x + c.x * CELL, z0: o.z + c.z * CELL, y0: o.y };
}

function cellCenter(rt, c) {
  const b = cellBox(rt, c);
  return { x: b.x0 + 6.5, y: b.y0 + 1, z: b.z0 + 6.5 };
}

function doorBox(rt, a, b) {
  const o = rt.origin;
  const ca = rt.layout.cells[a];
  const cb = rt.layout.cells[b];
  if (ca.z === cb.z) {
    const wx = o.x + Math.max(ca.x, cb.x) * CELL;
    const z = o.z + ca.z * CELL + 5;
    return box({ x: wx, y: o.y + 1, z }, { x: wx, y: o.y + 4, z: z + 2 });
  }
  const wz = o.z + Math.max(ca.z, cb.z) * CELL;
  const x = o.x + ca.x * CELL + 5;
  return box({ x, y: o.y + 1, z: wz }, { x: x + 2, y: o.y + 4, z: wz });
}

function corridorZ(rt) {
  return rt.origin.z + rt.rec.exitZ * CELL + 6;
}

export function arenaCenter(rt) {
  return { x: rt.origin.x + ARENA_CX + 0.5, y: rt.origin.y + 1, z: corridorZ(rt) + 0.5 };
}

function bounds(rt) {
  const o = rt.origin;
  const zc = corridorZ(rt);
  return {
    min: { x: o.x - 1, y: o.y - 2, z: Math.min(o.z, zc - ARENA_R - 2) - 1 },
    max: { x: o.x + ARENA_CX + ARENA_R + 3, y: o.y + 12, z: Math.max(o.z + SIZE, zc + ARENA_R + 2) + 1 },
  };
}

function buildPlan(rt) {
  const ops = new Map();
  const o = rt.origin;
  const y0 = o.y;
  const bd = bounds(rt);
  fillOp(ops, bd.min, bd.max, T.air); // ล้างพื้นที่ก่อน (แยกตาม chunk จึงไม่ไปลบของที่สร้างแล้ว)
  // ห้อง
  fillOp(ops, { x: o.x, y: y0, z: o.z }, { x: o.x + SIZE, y: y0, z: o.z + SIZE }, T.floor);
  fillOp(ops, { x: o.x, y: y0 + ROOM_H, z: o.z }, { x: o.x + SIZE, y: y0 + ROOM_H, z: o.z + SIZE }, T.wall);
  for (let k = 0; k <= GRID; k++) {
    fillOp(ops, { x: o.x + k * CELL, y: y0 + 1, z: o.z }, { x: o.x + k * CELL, y: y0 + ROOM_H - 1, z: o.z + SIZE }, T.wall);
    fillOp(ops, { x: o.x, y: y0 + 1, z: o.z + k * CELL }, { x: o.x + SIZE, y: y0 + ROOM_H - 1, z: o.z + k * CELL }, T.wall);
  }
  for (let i = 0; i < 70; i++) {
    const onX = Math.random() < 0.5;
    const k = randInt(0, GRID) * CELL;
    const t = randInt(0, SIZE);
    const p = onX ? { x: o.x + k, y: y0 + randInt(1, ROOM_H - 1), z: o.z + t } : { x: o.x + t, y: y0 + randInt(1, ROOM_H - 1), z: o.z + k };
    setOp(ops, p, Math.random() < 0.6 ? T.cry : T.ame);
  }
  const done = new Set();
  rt.layout.cells.forEach((c, i) => {
    for (const n of c.links) {
      const key = i < n ? `${i}-${n}` : `${n}-${i}`;
      if (done.has(key)) continue;
      done.add(key);
      const d = doorBox(rt, i, n);
      fillOp(ops, d.min, d.max, T.air);
    }
  });
  // ของตกแต่งในห้อง
  rt.layout.cells.forEach((c) => {
    const b = cellBox(rt, c);
    const cx = b.x0 + 6;
    const cz = b.z0 + 6;
    setOp(ops, { x: cx, y: y0 + ROOM_H, z: cz }, T.lamp);
    if (c.type === "start") {
      setOp(ops, { x: cx, y: y0, z: cz }, T.crystal);
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) setOp(ops, { x: cx + dx, y: y0, z: cz + dz }, T.lamp);
    } else if (c.type === "treasure") {
      fillOp(ops, { x: cx - 1, y: y0, z: cz - 1 }, { x: cx + 1, y: y0, z: cz + 1 }, T.crystal);
      for (const [dx, dz] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) setOp(ops, { x: cx + dx, y: y0 + 1, z: cz + dz }, T.cluster);
      const at = { x: cx, y: y0 + 1, z: cz };
      customOp(ops, at, (dim) => fillChest(dim, at, rt.rec.tier));
    } else if (c.type === "shrine") {
      setOp(ops, { x: cx, y: y0 + 1, z: cz }, T.crystal);
      setOp(ops, { x: cx, y: y0 + 2, z: cz }, T.lamp);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) setOp(ops, { x: cx + dx, y: y0, z: cz + dz }, T.lamp);
    } else {
      const spots = [[3, 3], [9, 3], [3, 9], [9, 9]].sort(() => Math.random() - 0.5).slice(0, randInt(2, 4));
      for (const [dx, dz] of spots) fillOp(ops, { x: b.x0 + dx, y: y0 + 1, z: b.z0 + dz }, { x: b.x0 + dx, y: y0 + 3, z: b.z0 + dz }, Math.random() < 0.3 ? T.ame : T.wall);
      for (let k = 0; k < randInt(2, 5); k++) setOp(ops, { x: b.x0 + randInt(2, 10), y: y0 + 1, z: b.z0 + randInt(2, 10) }, T.cluster);
    }
  });
  // ทางเดินไปลานบอส
  const zc = corridorZ(rt);
  const xa = o.x + SIZE;
  const xb = o.x + SIZE + CORR + 1;
  fillOp(ops, { x: xa, y: y0, z: zc - 2 }, { x: xb, y: y0, z: zc + 2 }, T.floor);
  fillOp(ops, { x: xa + 1, y: y0 + 1, z: zc - 2 }, { x: xb, y: y0 + 4, z: zc - 2 }, T.wall);
  fillOp(ops, { x: xa + 1, y: y0 + 1, z: zc + 2 }, { x: xb, y: y0 + 4, z: zc + 2 }, T.wall);
  fillOp(ops, { x: xa + 1, y: y0 + 5, z: zc - 2 }, { x: xb, y: y0 + 5, z: zc + 2 }, T.wall);
  fillOp(ops, { x: xa, y: y0 + 1, z: zc - 1 }, { x: xa, y: y0 + 4, z: zc + 1 }, T.air);
  for (let x = xa + 2; x <= xb; x += 3) setOp(ops, { x, y: y0 + 5, z: zc }, T.lamp);
  rt.corridorBarrier = box({ x: xa + 2, y: y0 + 1, z: zc - 1 }, { x: xa + 2, y: y0 + 4, z: zc + 1 });
  fillOp(ops, rt.corridorBarrier.min, rt.corridorBarrier.max, T.barrier);
  // ลานบอส
  const ac = { x: o.x + ARENA_CX, z: zc };
  for (let dz = -ARENA_R - 1; dz <= ARENA_R + 1; dz++) {
    const w = Math.floor(Math.sqrt(Math.max(0, (ARENA_R + 0.5) ** 2 - dz * dz)));
    if (w <= 0) continue;
    fillOp(ops, { x: ac.x - w, y: y0, z: ac.z + dz }, { x: ac.x + w, y: y0, z: ac.z + dz }, T.floor);
  }
  for (let a = 0; a < 360; a += 3) {
    const r = a * (Math.PI / 180);
    const ring = { x: Math.round(ac.x + Math.cos(r) * ARENA_R), y: y0, z: Math.round(ac.z + Math.sin(r) * ARENA_R) };
    setOp(ops, ring, T.cry);
    const wx = Math.round(ac.x + Math.cos(r) * (ARENA_R + 1));
    const wz = Math.round(ac.z + Math.sin(r) * (ARENA_R + 1));
    const towardCorridor = wx < ac.x && Math.abs(wz - ac.z) <= 2;
    if (!towardCorridor) {
      setOp(ops, { x: wx, y: y0, z: wz }, T.wall);
      fillOp(ops, { x: wx, y: y0 + 1, z: wz }, { x: wx, y: y0 + 2, z: wz }, T.wall);
    } else {
      setOp(ops, { x: wx, y: y0, z: wz }, T.floor);
    }
  }
  for (let k = 0; k < 4; k++) {
    const r = Math.PI / 4 + (k * Math.PI) / 2;
    const px = Math.round(ac.x + Math.cos(r) * 10);
    const pz = Math.round(ac.z + Math.sin(r) * 10);
    fillOp(ops, { x: px, y: y0 + 1, z: pz }, { x: px, y: y0 + 7, z: pz }, T.wall);
    setOp(ops, { x: px, y: y0 + 8, z: pz }, T.lamp);
  }
  for (let k = 0; k < 8; k++) {
    const r = (k * Math.PI) / 4;
    setOp(ops, { x: Math.round(ac.x + Math.cos(r) * 6), y: y0, z: Math.round(ac.z + Math.sin(r) * 6) }, T.lamp);
  }
  setOp(ops, { x: ac.x, y: y0, z: ac.z }, T.crystal);
  return ops;
}

function fillChest(dim, at, tier) {
  dim.setBlockType(at, "minecraft:chest");
  const inv = dim.getBlock(at)?.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  const rolls = 5 + tier * 2;
  for (let i = 0; i < rolls; i++) {
    const [id, mn, mx] = weightedPick(RIFT_LOOT[tier], 3);
    try {
      inv.setItem(randInt(0, inv.size - 1), new ItemStack(id, randInt(mn, mx)));
    } catch {}
  }
  if (Math.random() < 0.25 + tier * 0.1) {
    safe(() => inv.addItem(new ItemStack(pick(["arc:rune_fire", "arc:rune_frost", "arc:rune_storm", "arc:rune_leech"]), 1)));
  }
}

// ---------- สร้าง / เปิดรอยแยก ----------
function overlaps(a, b) {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.z <= b.max.z && a.max.z >= b.min.z && a.min.y <= b.max.y && a.max.y >= b.min.y;
}

function useSky() {
  return !riftDim || !!worldSettings().riftSky;
}

function allocate(player) {
  if (!useSky()) {
    // ช่องใหม่ทุกครั้ง (ไม่ใช้ซ้ำ) ห่างกัน 1024 บล็อก จึงไม่มีซากรอยแยกเก่ามาทับ
    const slot = (getWorld("arc:riftslot", 0) + 1) % 4096;
    setWorld("arc:riftslot", slot);
    const hr = safe(() => riftDim.heightRange) ?? { min: 0, max: 256 };
    const y = Math.max(hr.min + 10, Math.min(64, hr.max - 30));
    return { dim: riftDim, origin: { x: (slot % 64) * 1024 + 512, y, z: Math.floor(slot / 64) * 1024 + 512 }, slot };
  }
  const dim = player.dimension;
  if (dim.id === "minecraft:nether") return undefined;
  const hr = safe(() => dim.heightRange) ?? { min: -64, max: 320 };
  const y = Math.min(hr.max - 24, dim.id === "minecraft:the_end" ? 160 : 230);
  return { dim, origin: { x: Math.floor(player.location.x) - 24, y, z: Math.floor(player.location.z) - 24 }, slot: -1 };
}

export async function openRift(player, tier) {
  if (runtime.size >= MAX_RIFTS) {
    tell(player, "§cมีรอยแยกเปิดอยู่มากเกินไปแล้ว รอให้รอยแยกอื่นปิดก่อน");
    return false;
  }
  const alloc = allocate(player);
  if (!alloc) {
    tell(player, "§cเปิดรอยแยกในเนเธอร์ไม่ได้ (ไปโลกปกติหรือ The End)");
    return false;
  }
  const id = `r${Date.now().toString(36)}${randInt(0, 999)}`;
  const rt = {
    rec: { id, tier, dim: alloc.dim.id, origin: alloc.origin, slot: alloc.slot, players: [], state: "building", owner: player.id },
    dim: alloc.dim, origin: alloc.origin, layout: genLayout(), plan: null, queues: [], startQueues: [], firstPassDone: false,
    corridorOpen: false, bossSpawned: false, bossId: null, emptySince: 0, collapseAt: 0, portal: null, exitPortal: null,
    opened: system.currentTick, inside: [], ticking: null,
  };
  rt.rec.exitZ = rt.layout.cells[rt.layout.exit].z;
  const bd = bounds(rt);
  for (const other of runtime.values()) {
    if (other.dim.id === rt.dim.id && overlaps(bounds(other), bd)) {
      tell(player, "§cใกล้รอยแยกอื่นเกินไป");
      return false;
    }
  }
  preparePlan(rt);
  runtime.set(id, rt);
  saveRecords();
  spawnEntrance(player, rt);
  await prepareTicking(rt);
  system.runJob(buildJob(rt));
  return true;
}

function preparePlan(rt) {
  rt.plan = buildPlan(rt);
  const sp = startPos(rt);
  // สร้างห้องเริ่มต้นก่อนเสมอ แล้วไล่ออกไปตามระยะ
  rt.queues = [...rt.plan.values()].sort((a, b) => Math.hypot(a.cx * 16 + 8 - sp.x, a.cz * 16 + 8 - sp.z) - Math.hypot(b.cx * 16 + 8 - sp.x, b.cz * 16 + 8 - sp.z));
  const c = cellBox(rt, rt.layout.cells[rt.layout.start]);
  const keys = new Set();
  for (const x of [c.x0, c.x0 + CELL]) for (const z of [c.z0, c.z0 + CELL]) keys.add(`${Math.floor(x / 16)},${Math.floor(z / 16)}`);
  rt.startQueues = [...keys].map((k) => rt.plan.get(k)).filter(Boolean);
}

async function prepareTicking(rt) {
  const bd = bounds(rt);
  const opts = { dimension: rt.dim, from: bd.min, to: bd.max };
  try {
    const mgr = world.tickingAreaManager;
    if (!mgr.hasCapacity(opts)) return;
    const name = `arc_rift_${rt.rec.id}`;
    rt.rec.ticking = name;
    if (mgr.hasTickingArea(name)) mgr.removeTickingArea(name);
    await Promise.race([mgr.createTickingArea(name, opts), system.waitTicks(200)]);
    rt.ticking = name;
    saveRecords();
  } catch (err) {
    console.warn(`[Arcane] ticking area: ${err}`);
  }
}

function spawnEntrance(player, rt) {
  const dir = player.getViewDirection();
  const loc = { x: player.location.x + dir.x * 3, y: player.location.y, z: player.location.z + dir.z * 3 };
  try {
    const portal = player.dimension.spawnEntity("arc:rift_portal", loc);
    portal.setRotation({ x: 0, y: player.getRotation().y });
    portal.addTag(`arc_portal_${rt.rec.id}`);
    rt.portal = portal;
    rt.portalExpire = system.currentTick + 20 * 300;
    fx.implode(player.dimension, V.up(loc, 2), COL.void, 4, 40, 0.3);
    sound(player.dimension, "block.end_portal.spawn", loc, 1, 1.2);
    shakeNear(player.dimension, loc, 20, 0.3, 1);
  } catch (err) {
    console.warn(`[Arcane] portal: ${err}`);
  }
}

function startPos(rt) {
  return cellCenter(rt, rt.layout.cells[rt.layout.start]);
}

// ---------- เข้า / ออก ----------
export function activeRiftOf(player) {
  const id = getData(player).riftId;
  return id ? runtime.get(id) : undefined;
}

export function isInsideRift(player, rt) {
  if (!alive(player) || player.dimension.id !== rt.dim.id) return false;
  const bd = bounds(rt);
  const l = player.location;
  return l.x >= bd.min.x - 4 && l.x <= bd.max.x + 4 && l.z >= bd.min.z - 4 && l.z <= bd.max.z + 4 && l.y >= bd.min.y - 40 && l.y <= bd.max.y + 30;
}

const entering = new Map(); // player.id -> tick ที่เริ่มวาร์ปเข้า (กันวาร์ปซ้ำ)

export function enterRift(player, rt) {
  if ((entering.get(player.id) ?? -99) + 30 > system.currentTick) return;
  entering.set(player.id, system.currentTick);
  const d = getData(player);
  if (d.riftId !== rt.rec.id || !d.home) d.home = { dim: player.dimension.id, x: player.location.x, y: player.location.y, z: player.location.z };
  d.riftId = rt.rec.id;
  saveData(player);
  if (!rt.rec.players.includes(player.id)) {
    rt.rec.players.push(player.id);
    saveRecords();
  }
  const tier = RIFT_TIERS[rt.rec.tier];
  fade(player, { red: 0.35, green: 0.05, blue: 0.5 }, 0.25, 0.4, 0.9);
  psound(player, "mob.endermen.portal", 1, 0.6);
  system.runTimeout(() => {
    if (!alive(player)) return;
    const dest = startPos(rt);
    try {
      player.teleport(dest, { dimension: rt.dim, rotation: { x: 0, y: -90 } });
    } catch (err) {
      console.warn(`[Arcane] enter rift: ${err}`);
      return;
    }
    safe(() => player.addEffect("slow_falling", 200, { amplifier: 0, showParticles: false }));
    safe(() => player.addEffect("resistance", 100, { amplifier: 4, showParticles: false }));
    if (!floorUnderStart(rt)) holdPlayer(player, rt);
    pushFog(player, "arc:rift", "arc_rift");
    title(player, `${tier.color}§lรอยแยกมิติ ระดับ ${tier.name}`, "§7เคลียร์ทุกห้องเพื่อเปิดทางสู่ลานบอส", 10, 60, 20);
    psound(player, "beacon.activate", 1, 0.7);
  }, 7);
}

// ---------- กันตกมิติ: ตรึงผู้เล่นไว้ที่จุดเกิดจนกว่าพื้นจะถูกสร้าง ----------
const holds = new Map(); // player.id -> { rt, since }
const HOLD_LIMIT = 20 * 25; // ถ้า 25 วินาทียังสร้างพื้นไม่ได้ ถือว่ามิตินี้ใช้ไม่ได้ในเครื่องนี้

function floorUnderStart(rt) {
  const s = startPos(rt);
  const b = safe(() => rt.dim.getBlock({ x: Math.floor(s.x), y: rt.origin.y, z: Math.floor(s.z) }));
  return !!b && !b.isAir && !b.isLiquid;
}

function holdPlayer(player, rt) {
  if (!holds.has(player.id)) holds.set(player.id, { rt, since: system.currentTick });
}

function tickHolds() {
  const tick = system.currentTick;
  for (const [pid, h] of holds) {
    const p = /** @type {import("@minecraft/server").Player | undefined} */ (world.getEntity(pid));
    const rt = h.rt;
    if (!p || !alive(p) || rt.collapsing || p.dimension.id !== rt.dim.id) {
      holds.delete(pid);
      continue;
    }
    buildStep(rt, rt.startQueues, 40, [p]);
    if (!floorUnderStart(rt)) {
      // ลองวางแท่นยืนใต้จุดเกิดตรง ๆ (เป็นส่วนหนึ่งของพื้นห้องอยู่แล้ว)
      const s = startPos(rt);
      safe(() => rt.dim.fillBlocks(new BlockVolume({ x: Math.floor(s.x) - 1, y: rt.origin.y, z: Math.floor(s.z) - 1 }, { x: Math.floor(s.x) + 1, y: rt.origin.y, z: Math.floor(s.z) + 1 }), T.floor));
    }
    if (floorUnderStart(rt)) {
      holds.delete(pid);
      actionbar(p, "§dรอยแยกก่อตัวเสร็จแล้ว!");
      continue;
    }
    const s = startPos(rt);
    if (V.dist(p.location, s) > 0.6) safe(() => p.teleport(s, { keepVelocity: false }));
    safe(() => p.addEffect("slow_falling", 40, { amplifier: 0, showParticles: false }));
    actionbar(p, `§dรอยแยกกำลังก่อตัว... §7${Math.ceil((HOLD_LIMIT - (tick - h.since)) / 20)}`);
    if (tick - h.since > HOLD_LIMIT) {
      holds.delete(pid);
      failRift(rt);
    }
  }
}

/** สร้างดันเจี้ยนไม่สำเร็จ: ส่งทุกคนกลับ คืนกุญแจ และถ้าเป็นมิติใหม่ ครั้งหน้าจะสร้างบนท้องฟ้าแทน */
function failRift(rt) {
  if (rt.collapsing) return;
  const custom = rt.rec.slot >= 0;
  if (custom) {
    const ws = worldSettings();
    ws.riftSky = true;
    saveWorldSettings(ws);
  }
  console.warn(`[Arcane] rift ${rt.rec.id} could not be built in ${rt.dim.id}${custom ? " — switching to sky dungeons" : ""}`);
  const msg = custom
    ? "§cสร้างดันเจี้ยนในมิติใหม่ไม่สำเร็จบนอุปกรณ์นี้ §7— คืนกุญแจแล้ว ครั้งหน้าจะสร้างดันเจี้ยนบนท้องฟ้าแทน"
    : "§cสร้างดันเจี้ยนไม่สำเร็จ §7— คืนกุญแจแล้ว ลองเปิดใหม่ในที่โล่ง ๆ";
  const owner = /** @type {import("@minecraft/server").Player | undefined} */ (world.getEntity(rt.rec.owner));
  if (owner && alive(owner)) {
    safe(() => owner.getComponent("minecraft:inventory")?.container?.addItem(new ItemStack("arc:rift_key", 1)));
    tell(owner, msg);
  }
  collapse(rt, msg);
}

function homeOf(player) {
  const d = getData(player);
  if (d.home) {
    const dim = safe(() => world.getDimension(d.home.dim));
    if (dim) return { dim, loc: { x: d.home.x, y: d.home.y, z: d.home.z }, safeFall: false };
  }
  const sp = safe(() => player.getSpawnPoint());
  if (sp && sp.y < 1000) return { dim: sp.dimension, loc: { x: sp.x, y: sp.y, z: sp.z }, safeFall: false };
  const def = world.getDefaultSpawnLocation();
  return { dim: world.getDimension("overworld"), loc: { x: def.x, y: def.y < 1000 ? def.y : 200, z: def.z }, safeFall: def.y >= 1000 };
}

export function leaveRift(player, message = "§7คุณออกจากรอยแยกแล้ว") {
  const d = getData(player);
  const home = homeOf(player);
  d.riftId = null;
  d.home = null;
  saveData(player);
  popFog(player, "arc_rift");
  fade(player, { red: 0.35, green: 0.05, blue: 0.5 }, 0.2, 0.3, 0.8);
  system.runTimeout(() => {
    if (!alive(player)) return;
    try {
      player.teleport(home.loc, { dimension: home.dim });
      if (home.safeFall) safe(() => player.addEffect("slow_falling", 600, { amplifier: 0, showParticles: false }));
    } catch (err) {
      console.warn(`[Arcane] leave rift: ${err}`);
    }
    actionbar(player, message);
  }, 6);
}

// ---------- ห้องต่อสู้ ----------
function roomTag(rt, i) {
  return `arc_room_${rt.rec.id}_${i}`;
}

function setDoors(rt, i, block) {
  const cells = rt.layout.cells;
  for (const n of cells[i].links) {
    if (block === T.air && cells[n].started && !cells[n].cleared) continue;
    const d = doorBox(rt, i, n);
    if (block !== T.air) {
      for (const p of rt.inside) {
        const l = p.location;
        if (l.x >= d.min.x - 0.5 && l.x <= d.max.x + 1.5 && l.z >= d.min.z - 0.5 && l.z <= d.max.z + 1.5) safe(() => p.teleport(cellCenter(rt, cells[i])));
      }
    }
    safe(() => rt.dim.fillBlocks(new BlockVolume(d.min, d.max), block));
  }
}

function spawnWave(rt, i) {
  const c = rt.layout.cells[i];
  const tier = RIFT_TIERS[rt.rec.tier];
  const b = cellBox(rt, c);
  const n = Math.min(9, tier.perRoom + Math.max(0, rt.inside.length - 1) + c.wave);
  const tag = roomTag(rt, i);
  for (let k = 0; k < n; k++) {
    system.runTimeout(() => {
      let pos;
      for (let tries = 0; tries < 8; tries++) {
        pos = { x: b.x0 + rand(2, 10), y: b.y0 + 1, z: b.z0 + rand(2, 10) };
        if (!rt.inside.some((p) => alive(p) && V.distXZ(p.location, pos) < 3)) break;
      }
      fx.implode(rt.dim, V.up(pos, 1), COL.void, 2, 16);
      fx.smoke(rt.dim, V.up(pos, 1), { red: 0.2, green: 0.05, blue: 0.3 }, 0.6, 8, 0.8);
      try {
        const m = rt.dim.spawnEntity(pick(tier.mobs), pos);
        m.addTag("arc_rift");
        m.addTag(`arc_rift_${rt.rec.id}`);
        m.addTag(tag);
        for (const [eff, amp] of tier.effects) safe(() => m.addEffect(eff, 20000, { amplifier: amp, showParticles: false }));
      } catch {}
    }, k * 4);
  }
  c.wave++;
  c.checkAfter = system.currentTick + n * 4 + 30;
  sound(rt.dim, "mob.evocation_illager.prepare_summon", cellCenter(rt, c), 1, 0.8);
}

function startRoom(rt, i) {
  const c = rt.layout.cells[i];
  c.started = true;
  c.startedAt = system.currentTick;
  setDoors(rt, i, T.barrier);
  for (const p of rt.inside) actionbar(p, "§cประตูถูกผนึก! §7กำจัดศัตรูทั้งหมด");
  sound(rt.dim, "random.anvil_land", cellCenter(rt, c), 1, 0.5);
  spawnWave(rt, i);
}

function clearRoom(rt, i) {
  const c = rt.layout.cells[i];
  c.cleared = true;
  setDoors(rt, i, T.air);
  const center = cellCenter(rt, c);
  fx.rise(rt.dim, center, COL.gold, 4, 30, 3);
  sound(rt.dim, "random.levelup", center, 1, 1.2);
  for (const p of rt.inside) {
    addXp(p, 20 * rt.rec.tier);
    actionbar(p, "§aห้องปลอดภัยแล้ว!");
  }
  safe(() => {
    for (let k = 0; k < 3 + rt.rec.tier; k++) rt.dim.spawnEntity("minecraft:xp_orb", V.up(center, 0.5));
    rt.dim.spawnItem(new ItemStack("arc:arcane_shard", randInt(1, 2 + rt.rec.tier)), V.up(center, 0.5));
  });
  const left = rt.layout.cells.filter((x) => x.type === "combat" && !x.cleared).length;
  if (left === 0 && !rt.corridorOpen) openCorridor(rt);
  else if (left > 0) for (const p of rt.inside) tell(p, `§7เหลือห้องต่อสู้อีก §f${left} §7ห้อง`);
}

function openCorridor(rt) {
  rt.corridorOpen = true;
  safe(() => rt.dim.fillBlocks(new BlockVolume(rt.corridorBarrier.min, rt.corridorBarrier.max), T.air));
  for (const p of rt.inside) {
    title(p, "§d§lทางสู่ลานบอสเปิดแล้ว!", "§7ตามทางเดินทิศตะวันออก", 10, 60, 20);
    psound(p, "block.end_portal.spawn", 0.8, 1.4);
  }
}

function spawnBoss(rt) {
  rt.bossSpawned = true;
  rt.rec.state = "boss";
  saveRecords();
  const center = arenaCenter(rt);
  const tier = RIFT_TIERS[rt.rec.tier];
  shakeNear(rt.dim, center, 40, 0.4, 2);
  sound(rt.dim, "mob.wither.spawn", center, 1.5, 0.7);
  let t = 0;
  const id = system.runInterval(() => {
    t += 5;
    fx.rune(rt.dim, center, 2 + t / 10, COL.void, 0.35, 200);
    fx.implode(rt.dim, V.up(center, 2), COL.void, 6, 20, 0.25);
    if (t < 40) return;
    system.clearRun(id);
    try {
      const boss = rt.dim.spawnEntity(tier.boss, center);
      boss.addTag("arc_rift");
      boss.addTag(`arc_rift_${rt.rec.id}`);
      boss.addTag("arc_rift_boss");
      rt.bossId = boss.id;
      if (tier.eliteBoss) {
        boss.nameTag = "§d§lผู้พิทักษ์ผลึก";
        safe(() => boss.addEffect("health_boost", 20000, { amplifier: 9, showParticles: false }));
        safe(() => boss.getComponent("minecraft:health")?.resetToMaxValue());
        safe(() => boss.addEffect("strength", 20000, { amplifier: 1, showParticles: false }));
        safe(() => boss.addEffect("resistance", 20000, { amplifier: 0, showParticles: false }));
        for (const p of rt.inside) title(p, "§d§lผู้พิทักษ์ผลึก", "§7โกเลมผลึกโบราณผู้เฝ้ารอยแยก", 10, 50, 15);
      }
    } catch (err) {
      console.warn(`[Arcane] rift boss: ${err}`);
      rt.bossSpawned = false;
    }
  }, 5);
}

function complete(rt) {
  if (rt.rec.state === "complete") return;
  rt.rec.state = "complete";
  rt.collapseAt = system.currentTick + RIFT_COLLAPSE_SECONDS * 20;
  saveRecords();
  const center = arenaCenter(rt);
  const tier = rt.rec.tier;
  system.runTimeout(() => {
    safe(() => fillChest(rt.dim, V.floor(V.add(center, { x: 0, y: 0, z: 0 })), tier));
    try {
      const exit = rt.dim.spawnEntity("arc:rift_portal", { x: center.x - 5, y: center.y, z: center.z });
      exit.setRotation({ x: 0, y: 90 });
      exit.nameTag = "§aทางออก";
      exit.addTag(`arc_rift_${rt.rec.id}`);
      rt.exitPortal = exit;
    } catch {}
  }, 60);
  for (const p of rt.inside) {
    const d = getData(p);
    d.rift.clears[tier] = (d.rift.clears[tier] ?? 0) + 1;
    const secs = Math.round((system.currentTick - rt.opened) / 20);
    if (!d.rift.best[tier] || secs < d.rift.best[tier]) d.rift.best[tier] = secs;
    saveData(p);
    addXp(p, 200 * tier);
    questProgress(p, "rift", tier);
    tell(p, `§d✦ พิชิตรอยแยกระดับ ${roman(tier)} ในเวลา §f${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} §7— รอยแยกจะพังลงใน ${RIFT_COLLAPSE_SECONDS} วินาที เดินเข้าประตูทางออกได้เลย`);
  }
}

function collapse(rt, reason = "§5รอยแยกพังทลายแล้ว...") {
  if (rt.collapsing) return;
  rt.collapsing = true;
  for (const p of world.getAllPlayers()) {
    if (getData(p).riftId === rt.rec.id) {
      if (isInsideRift(p, rt)) leaveRift(p, reason);
      else {
        const d = getData(p);
        d.riftId = null;
        d.home = null;
        saveData(p);
      }
    }
  }
  holdsClear(rt);
  system.runTimeout(() => {
    safe(() => {
      for (const e of rt.dim.getEntities({ tags: [`arc_rift_${rt.rec.id}`] })) e.remove();
    });
    if (alive(rt.portal)) safe(() => rt.portal.remove());
    // ลบบล็อกทีละ chunk (chunk ที่ไม่โหลดจะลองใหม่เรื่อย ๆ สูงสุด 2 นาที)
    const plan = new Map();
    const bd = bounds(rt);
    fillOp(plan, bd.min, bd.max, T.air);
    rt.cleanup = [...plan.values()];
    rt.cleanupUntil = system.currentTick + 20 * 120;
  }, 20);
}

function holdsClear(rt) {
  for (const [pid, h] of holds) if (h.rt === rt) holds.delete(pid);
}

function tickCleanup(rt) {
  buildStep(rt, rt.cleanup, 40, world.getAllPlayers());
  if (rt.cleanup.every((q) => q.done) || system.currentTick > rt.cleanupUntil) {
    if (rt.ticking) safe(() => world.tickingAreaManager.removeTickingArea(rt.ticking));
    runtime.delete(rt.rec.id);
    saveRecords();
  }
}

// ---------- ลูปหลัก ----------
function tickRift(rt) {
  const tick = system.currentTick;
  if (rt.collapsing) return;
  if (rt.portal && alive(rt.portal)) {
    const ready = portalReady(rt);
    const tier = RIFT_TIERS[rt.rec.tier];
    safe(() => (rt.portal.nameTag = `${tier.color}§lรอยแยกมิติ ระดับ ${tier.name}\n${ready ? "§aเดินเข้ามาเพื่อเข้าสู่รอยแยก" : "§7กำลังเปิด..."}`));
    fx.swirl(rt.portal.dimension, V.up(rt.portal.location, 0.3), COL.void, 2.5, 6, 0.2);
    if (tick > rt.portalExpire || rt.rec.state === "complete") safe(() => rt.portal.remove());
  }
  rt.inside = world.getAllPlayers().filter((p) => getData(p).riftId === rt.rec.id && isInsideRift(p, rt));
  if (!allBuilt(rt)) buildStep(rt, rt.queues, 60, rt.inside);
  if (!rt.inside.length) {
    if (!rt.emptySince) rt.emptySince = tick;
    if (tick - rt.emptySince > RIFT_ABANDON_SECONDS * 20 && tick - rt.opened > 20 * 60) collapse(rt, "§5รอยแยกถูกทิ้งร้างและพังทลาย");
  } else rt.emptySince = 0;
  for (const p of rt.inside) {
    if (p.location.y < rt.origin.y - 6 && !holds.has(p.id)) {
      safe(() => p.teleport(startPos(rt), { keepVelocity: false }));
      safe(() => p.addEffect("slow_falling", 60, { amplifier: 0, showParticles: false }));
      if (!floorUnderStart(rt)) holdPlayer(p, rt);
      else actionbar(p, "§5ความว่างเปล่าผลักคุณกลับมา...");
    }
  }
  if (rt.rec.state === "building" && (rt.firstPassDone || startBuilt(rt))) {
    rt.rec.state = "open";
    saveRecords();
  }
  if (rt.rec.state === "building") return;
  const cells = rt.layout.cells;
  cells.forEach((c, i) => {
    const b = cellBox(rt, c);
    if (c.type === "combat" && !c.started) {
      if (rt.inside.some((p) => p.location.x > b.x0 + 2 && p.location.x < b.x0 + 10 && p.location.z > b.z0 + 2 && p.location.z < b.z0 + 10)) startRoom(rt, i);
    } else if (c.type === "combat" && !c.cleared && tick >= c.checkAfter) {
      let mobs = [];
      try {
        mobs = rt.dim.getEntities({ tags: [roomTag(rt, i)] });
      } catch {}
      if (!mobs.length) {
        if (c.wave < RIFT_TIERS[rt.rec.tier].waves) spawnWave(rt, i);
        else clearRoom(rt, i);
      } else if (tick - c.startedAt > 20 * 90) {
        const center = cellCenter(rt, c);
        for (const m of mobs) if (V.dist(m.location, center) > 14) safe(() => m.teleport(center));
      }
    } else if (c.type === "shrine") {
      const center = cellCenter(rt, c);
      if (tick % 20 < 10) fx.rise(rt.dim, center, COL.frost, 1.2, 4, 1.5, 0.12);
      for (const p of rt.inside) {
        if (V.dist(p.location, center) > 2.8) continue;
        heal(p, 1);
        addMana(p, 6);
        fx.line(rt.dim, V.up(center, 2), V.up(p.location, 1), COL.frost, 0.6, 0.12, 0.3);
      }
    }
  });
  const ac = arenaCenter(rt);
  if (rt.corridorOpen && !rt.bossSpawned && rt.inside.some((p) => V.distXZ(p.location, ac) < 11)) {
    // รอให้พื้นลานบอสสร้างเสร็จก่อน (chunk ไกล ๆ อาจเพิ่งโหลดตอนเดินมาถึง)
    const floor = safe(() => rt.dim.getBlock({ x: Math.floor(ac.x), y: rt.origin.y, z: Math.floor(ac.z) }));
    if (floor && !floor.isAir) spawnBoss(rt);
  }
  if (rt.bossSpawned && rt.rec.state === "boss" && rt.bossId) {
    const boss = world.getEntity(rt.bossId);
    if (boss && alive(boss) && V.distXZ(boss.location, ac) > 15) safe(() => boss.teleport(ac));
  }
  if (rt.rec.state === "complete") {
    const left = Math.ceil((rt.collapseAt - tick) / 20);
    if (left <= 30 && left % 10 === 0) for (const p of rt.inside) actionbar(p, `§5รอยแยกจะพังลงใน §f${left} §5วินาที! เดินเข้าประตูทางออก`);
    if (rt.exitPortal && alive(rt.exitPortal)) {
      fx.swirl(rt.dim, V.up(rt.exitPortal.location, 0.3), COL.nature, 2.5, 6, 0.2);
      for (const p of rt.inside) if (V.distXZ(p.location, rt.exitPortal.location) < 1.4 && Math.abs(p.location.y - rt.exitPortal.location.y) < 3) leaveRift(p, "§a✦ กลับสู่โลกปกติพร้อมสมบัติ!");
    }
    if (tick >= rt.collapseAt) collapse(rt);
  }
}

/** เข้าได้เมื่อห้องเริ่มต้นสร้างเสร็จ หรือรอเกิน 15 วินาที (บางเครื่องโหลด chunk เมื่อมีผู้เล่นอยู่เท่านั้น — ระบบจะตรึงผู้เล่นไว้จนพื้นเสร็จ) */
function portalReady(rt) {
  return startBuilt(rt) || (rt.firstPassDone && system.currentTick - rt.opened > 300);
}

function tickPortals() {
  for (const rt of runtime.values()) {
    if (!rt.portal || !alive(rt.portal) || !portalReady(rt) || rt.collapsing) continue;
    const pl = rt.portal.location;
    for (const p of rt.portal.dimension.getPlayers({ location: pl, maxDistance: 3 })) {
      if (getData(p).riftId === rt.rec.id && isInsideRift(p, rt)) continue;
      if (V.distXZ(p.location, pl) < 1.3 && Math.abs(p.location.y - pl.y) < 2.5) enterRift(p, rt);
    }
  }
}

// ---------- กุญแจรอยแยก ----------
export function useRiftKey(player) {
  const d = getData(player);
  const existing = activeRiftOf(player);
  if (existing && !existing.collapsing) {
    tell(player, "§7คุณมีรอยแยกที่ยังเปิดอยู่ — เปิดคัมภีร์ → รอยแยกมิติ เพื่อกลับเข้าไป");
    return;
  }
  const form = new ActionFormData().title("§d§lกุญแจรอยแยกมิติ").body("§7เลือกระดับความยาก (ใช้กุญแจ 1 ดอก)\n§8ห้อง 4x4 + ลานบอส • ปาร์ตี้เข้าทางประตูเดียวกันได้");
  const tiers = [1, 2, 3];
  for (const t of tiers) {
    const info = RIFT_TIERS[t];
    const unlocked = d.lvl >= info.level && (info.requires === 0 || (d.rift.clears[info.requires] ?? 0) > 0);
    const lock = unlocked ? "" : `\n§c🔒 เลเวล ${info.level}${info.requires ? ` + พิชิตระดับ ${roman(info.requires)}` : ""}`;
    form.button(`${info.color}§lระดับ ${info.name}§r §8(ผ่าน ${d.rift.clears[t] ?? 0} ครั้ง)${lock}`, "textures/arc_ui/menu_rift");
  }
  showForm(form, player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    const t = tiers[res.selection];
    const info = RIFT_TIERS[t];
    const unlocked = d.lvl >= info.level && (info.requires === 0 || (d.rift.clears[info.requires] ?? 0) > 0);
    if (!unlocked && !isCreative(player)) {
      tell(player, `§cยังเข้าไม่ได้: ต้องเลเวล ${info.level}${info.requires ? ` และพิชิตระดับ ${roman(info.requires)}` : ""}`);
      return;
    }
    if (!isCreative(player) && !consumeItem(player, "arc:rift_key", 1)) {
      tell(player, "§cไม่มีกุญแจรอยแยก");
      return;
    }
    openRift(player, t).then((ok) => {
      if (!ok && !isCreative(player)) safe(() => player.getComponent("minecraft:inventory")?.container?.addItem(new ItemStack("arc:rift_key", 1)));
    });
  });
}

export function riftList() {
  return [...runtime.values()];
}

export function riftById(id) {
  return runtime.get(id);
}

export function forceCollapseAll() {
  for (const rt of runtime.values()) collapse(rt, "§5ผู้ดูแลปิดรอยแยกทั้งหมด");
}

// ---------- เริ่มระบบ ----------
export function initRifts() {
  // รอยแยกที่ค้างจากการปิดเกม: พังทลายทั้งหมด (สถานะในหน่วยความจำหายไปแล้ว)
  for (const rec of records()) {
    const dim = safe(() => world.getDimension(rec.dim));
    if (!dim) continue;
    const rt = {
      rec, dim, origin: rec.origin, layout: { cells: [], start: 0, exit: 0 }, plan: null, queues: [], startQueues: [], firstPassDone: true,
      inside: [], ticking: rec.ticking ?? (rec.slot >= 0 ? `arc_rift_${rec.slot}` : `arc_rift_${rec.id}`), opened: 0,
    };
    if (rec.exitZ === undefined) rec.exitZ = 0;
    rt.layout.cells = [{ x: 0, z: 0, links: new Set() }];
    runtime.set(rec.id, rt);
    system.runTimeout(() => collapse(rt, "§5รอยแยกพังทลายระหว่างที่โลกปิดอยู่"), 60);
  }
  // ประตูมิติที่ค้างจากการเซฟเกม (ไม่มีรอยแยกเจ้าของแล้ว) -> ลบทิ้ง
  const isLivePortal = (e) => [...runtime.values()].some((rt) => (rt.portal && rt.portal.id === e.id) || (rt.exitPortal && rt.exitPortal.id === e.id));
  world.afterEvents.entityLoad.subscribe(({ entity }) => {
    if (entity.typeId === "arc:rift_portal" && !isLivePortal(entity)) system.run(() => alive(entity) && safe(() => entity.remove()));
  });
  system.runTimeout(() => {
    for (const d of ["overworld", "nether", "the_end"]) {
      for (const e of safe(() => world.getDimension(d).getEntities({ type: "arc:rift_portal" })) ?? []) if (!isLivePortal(e)) safe(() => e.remove());
    }
  }, 100);
  world.afterEvents.entityDie.subscribe((ev) => {
    let tags = [];
    try {
      tags = ev.deadEntity.getTags();
    } catch {
      return;
    }
    if (!tags.includes("arc_rift_boss")) return;
    const tag = tags.find((t) => t.startsWith("arc_rift_r"));
    const rt = tag ? runtime.get(tag.slice("arc_rift_".length)) : undefined;
    if (rt) complete(rt);
  });
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    system.runTimeout(() => {
      if (!alive(player)) return;
      const d = getData(player);
      const rt = d.riftId ? runtime.get(d.riftId) : undefined;
      const inRiftDim = riftDim && player.dimension.id === riftDim.id;
      if (initialSpawn && (inRiftDim || (d.riftId && !rt))) {
        if (!rt || rt.collapsing || !isInsideRift(player, rt)) leaveRift(player, "§5รอยแยกที่คุณอยู่พังทลายไปแล้ว");
        else pushFog(player, "arc:rift", "arc_rift");
      } else if (!initialSpawn && rt && !isInsideRift(player, rt)) {
        popFog(player, "arc_rift");
        tell(player, "§5คุณถูกผลักออกจากรอยแยก! §7เปิดคัมภีร์ → รอยแยกมิติ → กลับเข้าไป (ถ้ารอยแยกยังอยู่)");
      }
    }, 20);
  });
  world.afterEvents.playerDimensionChange.subscribe(({ player, toDimension }) => {
    if (riftDim && toDimension.id !== riftDim.id) popFog(player, "arc_rift");
  });
  world.beforeEvents.playerBreakBlock.subscribe((ev) => {
    if (ev.player.getGameMode() === "Creative") return;
    for (const rt of runtime.values()) {
      if (rt.dim.id !== ev.block.dimension.id) continue;
      const bd = bounds(rt);
      const l = ev.block.location;
      if (l.x >= bd.min.x && l.x <= bd.max.x && l.z >= bd.min.z && l.z <= bd.max.z && l.y >= bd.min.y && l.y <= bd.max.y) {
        ev.cancel = true;
        return;
      }
    }
  });
  world.beforeEvents.explosion.subscribe((ev) => {
    for (const rt of runtime.values()) {
      if (rt.dim.id !== ev.dimension.id) continue;
      const bd = bounds(rt);
      const keep = ev.getImpactedBlocks().filter((b) => {
        const l = b.location;
        return !(l.x >= bd.min.x && l.x <= bd.max.x && l.z >= bd.min.z && l.z <= bd.max.z && l.y >= bd.min.y && l.y <= bd.max.y);
      });
      ev.setImpactedBlocks(keep);
    }
  });
  system.runInterval(() => {
    for (const rt of [...runtime.values()]) {
      try {
        if (rt.cleanup) tickCleanup(rt);
        else tickRift(rt);
      } catch (err) {
        console.warn(`[Arcane] rift tick: ${err}`);
      }
    }
  }, 10);
  system.runInterval(tickHolds, 2);
  system.runInterval(tickPortals, 4);
}

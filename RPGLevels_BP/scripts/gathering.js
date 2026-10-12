// ขุด / ตัดไม้ / เกษตร: XP, ขุดแร่ทั้งสาย, ตัดต้นไม้ทั้งต้น, เอฟเฟกต์ความชำนาญเครื่องมือ

import { BlockPermutation, ItemStack, system, world } from "@minecraft/server";
import {
  BLOCKS_PER_TICK,
  CROPS,
  ORE_DROPS,
  ORE_VANILLA_XP,
  ORE_XP,
  SHOVEL_BLOCKS,
  SMELT,
  TREASURE_BASIC,
  TREASURE_RARE,
  WHOLE_CROPS,
  statFx,
  treeLimit,
  veinLimit,
} from "./config.js";
import { getData } from "./data.js";
import { addProfXp, addXp, skillOn } from "./progression.js";
import {
  center,
  chance,
  damageTool,
  destroyBlock,
  enchantLevel,
  isCreative,
  itemsNear,
  key,
  mainhand,
  randInt,
  runBatched,
  stackOf,
  takeFromInventory,
  toolCategory,
} from "./util.js";

/** ทิศรอบตัว 26 ทิศ (รวมแนวทแยง) */
const AROUND = [];
for (let x = -1; x <= 1; x++)
  for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) AROUND.push([x, y, z]);

// ---------------------------------------------------------------------------
// ตัวช่วยจำแนกบล็อก
// ---------------------------------------------------------------------------

const oreFamily = (id) => id.replace("deepslate_", "").replace("lit_", "");
const oreShortName = (id) => oreFamily(id).replace("minecraft:", "").replace("_ore", "");

function isLog(id) {
  if (id.includes("stripped")) return false;
  if (id.endsWith("_log")) return true;
  return id === "minecraft:crimson_stem" || id === "minecraft:warped_stem";
}

function isNaturalLeaves(block) {
  if (!block.typeId.includes("leaves")) return false;
  try {
    return block.permutation.getState("persistent_bit") !== true; // ใบไม้ที่ผู้เล่นวางเองจะเป็น true
  } catch {
    return true;
  }
}

/** ใช้ตรวจว่าเป็น "ต้นไม้ธรรมชาติ" ไม่ใช่บ้านไม้ */
function isCanopy(block) {
  const id = block.typeId;
  return (
    isNaturalLeaves(block) ||
    id === "minecraft:nether_wart_block" ||
    id === "minecraft:warped_wart_block" ||
    id === "minecraft:shroomlight"
  );
}

/** ค้นหาบล็อกที่ติดกันแบบ BFS */
function floodFill(dimension, origin, match, limit, allowPos) {
  const seen = new Set([key(origin)]);
  const queue = [origin];
  const out = [];
  for (let qi = 0; qi < queue.length && out.length < limit; qi++) {
    const cur = queue[qi];
    for (const [dx, dy, dz] of AROUND) {
      const p = { x: cur.x + dx, y: cur.y + dy, z: cur.z + dz };
      const k = key(p);
      if (seen.has(k)) continue;
      seen.add(k);
      if (allowPos && !allowPos(p)) continue;
      let block;
      try {
        block = dimension.getBlock(p);
      } catch {
        continue; // นอกโลก / chunk ไม่โหลด
      }
      if (!block || !match(block)) continue;
      out.push(p);
      queue.push(p);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function boundsOf(positions) {
  const min = { ...positions[0] };
  const max = { ...positions[0] };
  for (const p of positions) {
    min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
  }
  const mid = { x: (min.x + max.x + 1) / 2, y: (min.y + max.y + 1) / 2, z: (min.z + max.z + 1) / 2 };
  const radius = Math.hypot(max.x - min.x + 1, max.y - min.y + 1, max.z - min.z + 1) / 2 + 2;
  return { mid, radius };
}

// ---------------------------------------------------------------------------
// จัดการของที่ดรอป: หลอม / ดรอปคู่ / Fortune / ส่งเข้าหาผู้เล่น
// ---------------------------------------------------------------------------

/** ไอเท็มที่จัดการไปแล้ว ไม่ให้คูณซ้ำ */
const processed = new Set();
system.runInterval(() => processed.clear(), 200);

function spawnStack(dimension, typeId, amount, location) {
  let max = 64;
  try {
    max = new ItemStack(typeId, 1).maxAmount;
  } catch {
    return;
  }
  while (amount > 0) {
    const n = Math.min(max, amount);
    amount -= n;
    const ent = dimension.spawnItem(new ItemStack(typeId, n), location);
    processed.add(ent.id);
  }
}

/**
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {import("@minecraft/server").Vector3} location
 * @param {number} radius
 * @param {{ smelt?: boolean, double?: number, triple?: number, fortune?: number, toPlayer?: import("@minecraft/server").Player }} opts
 */
function processDrops(dimension, location, radius, opts) {
  system.run(() => {
    let items;
    try {
      items = itemsNear(dimension, location, radius);
    } catch {
      return;
    }
    const target = opts.toPlayer?.isValid ? opts.toPlayer : undefined;
    for (const ent of items) {
      if (processed.has(ent.id)) {
        if (target) ent.teleport(target.location, { dimension: target.dimension });
        continue;
      }
      processed.add(ent.id);
      const stack = stackOf(ent);
      if (!stack) continue;

      let id = stack.typeId;
      let amount = stack.amount;
      let changed = false;
      if (ORE_DROPS.has(id)) {
        if (opts.smelt && SMELT[id]) {
          id = SMELT[id];
          changed = true;
        }
        if (opts.fortune && !id.includes("netherite") && id !== "minecraft:ancient_debris") {
          const extra = randInt(0, opts.fortune);
          if (extra > 0) {
            amount += extra * stack.amount;
            changed = true;
          }
        }
        let mult = 1;
        if (chance(opts.triple ?? 0)) mult = 3;
        else if (chance(opts.double ?? 0)) mult = 2;
        if (mult > 1) {
          amount *= mult;
          changed = true;
        }
      }

      if (changed) {
        const where = target ? target.location : ent.location;
        ent.remove();
        spawnStack(target ? target.dimension : dimension, id, amount, where);
      } else if (target) {
        ent.teleport(target.location, { dimension: target.dimension });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// แร่
// ---------------------------------------------------------------------------

function onOre(player, d, dimension, pos, id, tool, cat) {
  addXp(player, ORE_XP[id]);
  const pickLv = cat === "pickaxe" ? d.prof.pickaxe.level : 0;
  if (cat === "pickaxe") addProfXp(player, "pickaxe", Math.ceil(ORE_XP[id] / 2) + 1);
  if (pickLv >= 40) player.addExperience(ORE_VANILLA_XP[oreShortName(id)] ?? 1);

  const silk = enchantLevel(tool, "silk_touch") > 0;
  const dropOpts = {
    smelt: !silk && skillOn(player, "auto_smelt"),
    double: silk ? 0 : statFx.doubleDrop(d.stats) + (pickLv >= 20 ? 0.15 : 0),
    triple: silk ? 0 : pickLv >= 50 ? 0.1 : 0,
  };
  processDrops(dimension, center(pos), 1.5, dropOpts);

  if (cat !== "pickaxe" || !skillOn(player, "vein_miner")) return;
  if (d.settings.veinSneak && !player.isSneaking) return;

  const family = oreFamily(id);
  const limit = veinLimit(d.level) + (pickLv >= 50 ? 64 : 0);
  const found = floodFill(dimension, pos, (b) => ORE_XP[b.typeId] !== undefined && oreFamily(b.typeId) === family, limit);
  if (found.length === 0) return;

  const fortune = silk ? 0 : enchantLevel(tool, "fortune");
  let broken = 0;
  runBatched(
    found,
    BLOCKS_PER_TICK,
    (p) => {
      if (!player.isValid || toolCategory(mainhand(player)) !== "pickaxe") return false;
      const block = dimension.getBlock(p);
      if (!block || ORE_XP[block.typeId] === undefined) return;
      if (!damageTool(player, 1)) {
        player.sendMessage("§c[RPG] หยุดขุดแร่ทั้งสาย เพื่อไม่ให้อีเตอร์พัง");
        return false;
      }
      const bid = block.typeId;
      destroyBlock(dimension, p, silk);
      broken++;
      addXp(player, ORE_XP[bid]);
      addProfXp(player, "pickaxe", Math.ceil(ORE_XP[bid] / 2) + 1);
      if (pickLv >= 40) player.addExperience(ORE_VANILLA_XP[oreShortName(bid)] ?? 1);
    },
    () => {
      if (broken === 0 || !player.isValid) return;
      const { mid, radius } = boundsOf(found);
      processDrops(dimension, mid, radius, { ...dropOpts, fortune, toPlayer: player });
      player.onScreenDisplay.setActionBar(`§bขุดแร่ทั้งสาย: §f${broken + 1} ก้อน`);
    }
  );
}

// ---------------------------------------------------------------------------
// ไม้
// ---------------------------------------------------------------------------

function onLog(player, d, dimension, pos, id, cat) {
  addXp(player, 2);
  if (cat !== "axe") return;
  const axeLv = d.prof.axe.level;
  addProfXp(player, "axe", 2);
  if (axeLv >= 40 && chance(0.3)) spawnStack(dimension, id, 1, center(pos));

  if (!skillOn(player, "tree_feller")) return;
  if (d.settings.treeSneak && !player.isSneaking) return;

  // สำรวจลำต้นทั้งหมด (สูงสุด 600) เพื่อเช็กว่ามีใบไม้ แล้วค่อยตัดตามขีดจำกัดของเลเวล
  let hasCanopy = false;
  const trunk = floodFill(
    dimension,
    pos,
    (b) => {
      if (b.typeId === id) return true;
      if (!hasCanopy && isCanopy(b)) hasCanopy = true;
      return false;
    },
    600,
    (p) => p.y >= pos.y
  );
  // ไม่มีใบไม้ติดเลย = น่าจะเป็นสิ่งก่อสร้าง ไม่ตัดทั้งหมด
  if (trunk.length === 0 || !hasCanopy) return;
  const logs = trunk.slice(0, treeLimit(d.level));

  let leaves = [];
  if (d.settings.treeLeaves) leaves = findLeaves(dimension, logs, 4, 400);

  let broken = 0;
  runBatched(
    logs,
    BLOCKS_PER_TICK,
    (p) => {
      if (!player.isValid || toolCategory(mainhand(player)) !== "axe") return false;
      const block = dimension.getBlock(p);
      if (!block || block.typeId !== id) return;
      if (!damageTool(player, 1)) {
        player.sendMessage("§c[RPG] หยุดตัดต้นไม้ เพื่อไม่ให้ขวานพัง");
        return false;
      }
      destroyBlock(dimension, p);
      broken++;
      addXp(player, 1);
      addProfXp(player, "axe", 1);
      if (axeLv >= 40 && chance(0.3)) spawnStack(dimension, id, 1, center(p));
    },
    () => {
      const finish = () => {
        if (!player.isValid) return;
        const { mid, radius } = boundsOf([...logs, ...leaves]);
        processDrops(dimension, mid, radius, { toPlayer: player });
        player.onScreenDisplay.setActionBar(`§aตัดต้นไม้ทั้งต้น: §f${broken + 1} ท่อน`);
      };
      if (broken === 0) return;
      runBatched(
        leaves,
        BLOCKS_PER_TICK * 3,
        (p) => {
          const block = dimension.getBlock(p);
          if (block && isNaturalLeaves(block)) destroyBlock(dimension, p);
        },
        finish
      );
    }
  );
}

/** หาใบไม้ธรรมชาติรอบ ๆ ลำต้น ไม่เกิน `depth` บล็อกจากไม้ */
function findLeaves(dimension, logs, depth, limit) {
  const seen = new Set(logs.map(key));
  let frontier = logs;
  const out = [];
  for (let level = 0; level < depth && frontier.length && out.length < limit; level++) {
    const next = [];
    for (const cur of frontier) {
      for (const [dx, dy, dz] of AROUND) {
        const p = { x: cur.x + dx, y: cur.y + dy, z: cur.z + dz };
        const k = key(p);
        if (seen.has(k)) continue;
        seen.add(k);
        let block;
        try {
          block = dimension.getBlock(p);
        } catch {
          continue;
        }
        if (!block || !isNaturalLeaves(block)) continue;
        out.push(p);
        next.push(p);
        if (out.length >= limit) return out;
      }
    }
    frontier = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// เกษตร
// ---------------------------------------------------------------------------

function isMature(id, permutation) {
  if (WHOLE_CROPS[id]) return true;
  const info = CROPS[id];
  if (!info) return false;
  const g = permutation.getState(/** @type {any} */ (info.state));
  return typeof g === "number" && g >= info.max;
}

function replant(player, dimension, pos, cropId) {
  const info = CROPS[cropId];
  system.runTimeout(() => {
    const block = dimension.getBlock(pos);
    const below = dimension.getBlock({ x: pos.x, y: pos.y - 1, z: pos.z });
    if (!block?.isAir || !below) return;
    const soil = cropId === "minecraft:nether_wart" ? "minecraft:soul_sand" : "minecraft:farmland";
    if (below.typeId !== soil) return;

    // ใช้เมล็ดที่ตกอยู่ก่อน ถ้าไม่มีค่อยเอาจากกระเป๋า
    let paid = false;
    for (const ent of itemsNear(dimension, center(pos), 1.5)) {
      const stack = stackOf(ent);
      if (stack?.typeId !== info.seed) continue;
      const loc = ent.location;
      ent.remove();
      if (stack.amount > 1) spawnStack(dimension, info.seed, stack.amount - 1, loc);
      paid = true;
      break;
    }
    if (!paid && player.isValid && !takeFromInventory(player, info.seed)) return;
    block.setPermutation(BlockPermutation.resolve(cropId));
  }, 2);
}

function harvestPerks(player, hoeLv, dimension, pos, id) {
  const produce = CROPS[id]?.produce ?? WHOLE_CROPS[id];
  if (hoeLv >= 10 && chance(0.25)) spawnStack(dimension, produce, 1, center(pos));
  if (hoeLv >= 40 && chance(0.4)) spawnStack(dimension, produce, randInt(1, 3), center(pos));
  if (hoeLv >= 20 && CROPS[id]) replant(player, dimension, pos, id);
}

function onCrop(player, d, dimension, pos, id, permutation, cat) {
  if (!isMature(id, permutation)) return;
  addXp(player, 3);
  if (cat !== "hoe") return;
  const hoeLv = d.prof.hoe.level;
  addProfXp(player, "hoe", 3);
  harvestPerks(player, hoeLv, dimension, pos, id);

  if (hoeLv < 50) return;
  for (const [dx, , dz] of AROUND.filter(([, y]) => y === 0)) {
    const p = { x: pos.x + dx, y: pos.y, z: pos.z + dz };
    const block = dimension.getBlock(p);
    if (!block || !(CROPS[block.typeId] || WHOLE_CROPS[block.typeId])) continue;
    if (!isMature(block.typeId, block.permutation)) continue;
    const bid = block.typeId;
    destroyBlock(dimension, p);
    addXp(player, 3);
    addProfXp(player, "hoe", 1);
    harvestPerks(player, hoeLv, dimension, p, bid);
  }
}

/** เร่งพืชรอบจุดให้โตขึ้น 1 ขั้น (ใช้กับสกิล/ความชำนาญจอบ) */
export function growAround(dimension, origin, radius, attempts) {
  for (let i = 0; i < attempts; i++) {
    const p = {
      x: Math.floor(origin.x) + randInt(-radius, radius),
      y: Math.floor(origin.y) + randInt(-1, 1),
      z: Math.floor(origin.z) + randInt(-radius, radius),
    };
    let block;
    try {
      block = dimension.getBlock(p);
    } catch {
      continue;
    }
    if (!block || block.isAir) continue;
    const id = block.typeId;
    const stateName = CROPS[id]?.state ?? (id.endsWith("_stem") || id.includes("crop") || id === "minecraft:sweet_berry_bush" ? "growth" : undefined);
    if (!stateName) continue;
    try {
      const perm = block.permutation;
      const g = perm.getState(/** @type {any} */ (stateName));
      if (typeof g !== "number") continue;
      block.setPermutation(perm.withState(/** @type {any} */ (stateName), g + 1));
      dimension.spawnParticle("minecraft:crop_growth_emitter", center(p));
    } catch {
      // โตสุดแล้ว
    }
  }
}

// ---------------------------------------------------------------------------
// บล็อกอื่น ๆ (หิน ดิน ทราย ฯลฯ)
// ---------------------------------------------------------------------------

function onOther(player, d, dimension, pos, id, cat) {
  addXp(player, 0.3);
  if (cat === "pickaxe") addProfXp(player, "pickaxe", 1);
  else if (cat === "axe") addProfXp(player, "axe", 1);
  else if (cat === "shovel" && SHOVEL_BLOCKS.has(id)) {
    const lv = d.prof.shovel.level;
    addProfXp(player, "shovel", 1);
    if (lv >= 40 && chance(0.04)) {
      const pool = chance(0.3) ? TREASURE_RARE : TREASURE_BASIC;
      spawnStack(dimension, pool[randInt(0, pool.length - 1)], 1, center(pos));
      player.onScreenDisplay.setActionBar("§6เจอสมบัติ!");
    } else if (lv >= 20 && chance(0.02)) {
      spawnStack(dimension, TREASURE_BASIC[randInt(0, TREASURE_BASIC.length - 1)], 1, center(pos));
      player.onScreenDisplay.setActionBar("§6เจอสมบัติ!");
    }
    if (lv >= 50 && player.isSneaking) dig3x3(player, dimension, pos);
  }
}

function dig3x3(player, dimension, pos) {
  const v = player.getViewDirection();
  let axes;
  if (Math.abs(v.y) > 0.7) axes = [[1, 0, 0], [0, 0, 1]];
  else if (Math.abs(v.x) > Math.abs(v.z)) axes = [[0, 1, 0], [0, 0, 1]];
  else axes = [[1, 0, 0], [0, 1, 0]];
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      if (!a && !b) continue;
      const p = {
        x: pos.x + a * axes[0][0] + b * axes[1][0],
        y: pos.y + a * axes[0][1] + b * axes[1][1],
        z: pos.z + a * axes[0][2] + b * axes[1][2],
      };
      const block = dimension.getBlock(p);
      if (!block || !SHOVEL_BLOCKS.has(block.typeId)) continue;
      if (!damageTool(player, 1)) return;
      destroyBlock(dimension, p);
      addProfXp(player, "shovel", 1);
    }
  }
}

// ---------------------------------------------------------------------------

export function initGathering() {
  world.afterEvents.playerBreakBlock.subscribe((ev) => {
    const { player, block, brokenBlockPermutation: perm, itemStackBeforeBreak: tool } = ev;
    if (isCreative(player)) return;
    const id = perm.type.id;
    const dimension = block.dimension;
    const pos = block.location;
    const d = getData(player);
    const cat = toolCategory(tool);
    try {
      if (ORE_XP[id] !== undefined) onOre(player, d, dimension, pos, id, tool, cat);
      else if (isLog(id)) onLog(player, d, dimension, pos, id, cat);
      else if (CROPS[id] || WHOLE_CROPS[id]) onCrop(player, d, dimension, pos, id, perm, cat);
      else onOther(player, d, dimension, pos, id, cat);
    } catch (e) {
      console.warn(`[RPG Levels] break handler: ${e}`);
    }
  });
}

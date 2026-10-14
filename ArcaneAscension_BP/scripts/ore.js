import { world, system, ItemStack, BlockVolume, LocationWaypoint, WaypointTexture } from "@minecraft/server";
import {
  ORE_VEIN_INTERVAL, ORE_VEIN_CHANCE, ORE_VEIN_RADIUS, ORE_VEIN_MAX_NEARBY, ORE_SHARDS, STONE_SHARD_CHANCE,
  AMETHYST_SHARD_CHANCE, ORE_SENSE_RADIUS, ORE_SENSE_MANA, ORE_SENSE_COOLDOWN,
} from "./config.js";
import { getData, markDirty } from "./data.js";
import { addXp, addMana, questProgress } from "./progression.js";
import { fx, COL, sound, psound } from "./fx.js";
import { V, randInt, chance, safe, tell, actionbar, isCreative, isSurvivalLike } from "./util.js";

// ============================================================================
//  แร่อาร์เคนหาง่ายขึ้น
//  1) สายแร่งอกในผนังถ้ำรอบตัวผู้เล่น (ใช้ได้กับ chunk เก่าที่สร้างก่อนลง addon ด้วย)
//  2) สัมผัสพลังเวท: ย่อตัว + ใช้คัมภีร์ = ชี้ทางไปแร่ที่ใกล้ที่สุด (มีจุดบน Locator Bar)
//  3) ดรอปเพิ่ม: แร่ให้เศษผลึกมากขึ้น, ขุดหินมีโอกาสได้เศษผลึก, กระจุกอเมทิสต์ให้บ่อยขึ้น
// ============================================================================
const ORE = "arc:arcane_ore";
const DEEP_ORE = "arc:deepslate_arcane_ore";
const ORE_TYPES = [ORE, DEEP_ORE];
const HOST = new Set(["minecraft:stone", "minecraft:granite", "minecraft:diorite", "minecraft:andesite", "minecraft:deepslate", "minecraft:tuff"]);
const DEEP_HOST = new Set(["minecraft:deepslate", "minecraft:tuff"]);
const STONE_LIKE = new Set([...HOST, "minecraft:cobblestone", "minecraft:cobbled_deepslate", "minecraft:calcite", "minecraft:dripstone_block"]);
const SIDES = [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];

function exposed(dim, p) {
  for (const s of SIDES) {
    const b = safe(() => dim.getBlock(V.add(p, s)));
    if (b && b.isAir) return true;
  }
  return false;
}

function nearbyOres(dim, c, r) {
  try {
    const vol = new BlockVolume({ x: c.x - r, y: c.y - r, z: c.z - r }, { x: c.x + r, y: c.y + r, z: c.z + r });
    return dim.getBlocks(vol, { includeTypes: ORE_TYPES }, false).getCapacity();
  } catch {
    return 0;
  }
}

/** สร้างสายแร่ 2-5 ก้อนในผนังถ้ำใกล้ ๆ ผู้เล่น */
function growVein(player) {
  const dim = player.dimension;
  const base = V.floor(player.location);
  if (nearbyOres(dim, base, 10) >= ORE_VEIN_MAX_NEARBY) return false;
  for (let tries = 0; tries < 40; tries++) {
    const p = {
      x: base.x + randInt(-ORE_VEIN_RADIUS, ORE_VEIN_RADIUS),
      y: base.y + randInt(-5, 4),
      z: base.z + randInt(-ORE_VEIN_RADIUS, ORE_VEIN_RADIUS),
    };
    if (Math.abs(p.x - base.x) + Math.abs(p.z - base.z) < 3) continue; // ไม่เกิดใต้เท้า
    const b = safe(() => dim.getBlock(p));
    if (!b || !HOST.has(b.typeId) || !exposed(dim, p)) continue;
    let placed = 0;
    let cur = p;
    const size = randInt(2, 5);
    for (let k = 0; k < size * 3 && placed < size; k++) {
      const blk = safe(() => dim.getBlock(cur));
      if (blk && HOST.has(blk.typeId)) {
        const ore = DEEP_HOST.has(blk.typeId) ? DEEP_ORE : ORE;
        if (safe(() => (blk.setType(ore), true))) placed++;
      }
      cur = V.add(cur, SIDES[randInt(0, 5)]);
    }
    if (!placed) continue;
    const at = { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
    fx.shards(dim, at, COL.arcane, 10, 2.5, 0.12);
    fx.rise(dim, at, COL.arcane, 0.5, 8, 1.2, 0.12);
    return true;
  }
  return false;
}

function veinTick() {
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== "minecraft:overworld" || !isSurvivalLike(p)) continue;
    const head = V.floor(V.up(p.location, 1));
    const sky = safe(() => p.dimension.getSkyLightLevel(head)) ?? 15;
    if (p.location.y > 62 && sky > 6) continue; // อยู่บนพื้นผิว
    if (!chance(ORE_VEIN_CHANCE)) continue;
    growVein(p);
  }
}

// ---------- สัมผัสพลังเวท (ย่อตัว + ใช้คัมภีร์) ----------
const senseCd = new Map();
const senseWaypoints = new Map(); // player.id -> waypoint

const ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];

function arrowTo(player, target) {
  const to = V.sub(target, player.location);
  const yaw = (player.getRotation().y * Math.PI) / 180;
  // ทิศที่ผู้เล่นหันหน้า (Minecraft: yaw 0 = +Z)
  const fx_ = -Math.sin(yaw);
  const fz = Math.cos(yaw);
  const ang = Math.atan2(to.z * fx_ - to.x * fz, to.x * fx_ + to.z * fz); // บวก = ขวามือ
  const idx = ((Math.round((ang / (Math.PI * 2)) * 8) % 8) + 8) % 8;
  return ARROWS[idx];
}

export function oreSense(player) {
  const now = system.currentTick;
  const ready = senseCd.get(player.id) ?? 0;
  if (now < ready) {
    actionbar(player, `§7สัมผัสพลังเวทพร้อมในอีก ${Math.ceil((ready - now) / 20)} วินาที`);
    return;
  }
  const d = getData(player);
  if (!isCreative(player) && d.mana < ORE_SENSE_MANA) {
    actionbar(player, `§9มานาไม่พอ (ต้องการ ${ORE_SENSE_MANA})`);
    return;
  }
  senseCd.set(player.id, now + ORE_SENSE_COOLDOWN);
  if (!isCreative(player)) addMana(player, -ORE_SENSE_MANA);
  const dim = player.dimension;
  const c = V.floor(player.location);
  const R = ORE_SENSE_RADIUS;
  const found = [];
  try {
    const vol = new BlockVolume({ x: c.x - R, y: c.y - R, z: c.z - R }, { x: c.x + R, y: c.y + R, z: c.z + R });
    const list = dim.getBlocks(vol, { includeTypes: ORE_TYPES, location: c, closest: 5 }, false);
    for (const loc of list.getBlockLocationIterator()) found.push({ x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 });
  } catch (err) {
    console.warn(`[Arcane] ore sense: ${err}`);
  }
  fx.ring(dim, player.location, 4, COL.arcane, 0.6);
  fx.implode(dim, V.up(player.location, 1), COL.arcane, 3, 20);
  psound(player, "block.enchanting_table.use", 1, 1.6);
  if (!found.length) {
    tell(player, `§7ไม่พบแร่อาร์เคนในระยะ ${R} บล็อก §8— ลองลงไปในถ้ำลึกกว่านี้ (สายแร่จะงอกในผนังถ้ำรอบตัวคุณเรื่อย ๆ)`);
    return;
  }
  found.sort((a, b) => V.dist(a, player.location) - V.dist(b, player.location));
  const target = found[0];
  tell(player, `§d✦ สัมผัสได้ถึงแร่อาร์เคน ${found.length} จุด §7— ใกล้สุด ${Math.round(V.dist(target, player.location))} บล็อก (ดูลูกศรและจุดบน Locator Bar)`);
  // จุดบนแถบตำแหน่ง 30 วินาที
  safe(() => {
    const old = senseWaypoints.get(player.id);
    if (old) player.locatorBar.removeWaypoint(old);
    const wp = new LocationWaypoint({ ...target, dimension: dim }, { textureBoundsList: [{ lowerBound: 0, texture: WaypointTexture.SmallStar }] }, { red: 0.75, green: 0.45, blue: 1 });
    player.locatorBar.addWaypoint(wp);
    senseWaypoints.set(player.id, wp);
    system.runTimeout(() => {
      if (senseWaypoints.get(player.id) !== wp) return;
      safe(() => player.locatorBar.removeWaypoint(wp));
      senseWaypoints.delete(player.id);
    }, 600);
  });
  // ลูกศรนำทาง + เส้นแสงพุ่งไปทางแร่ 10 วินาที
  let t = 0;
  const id = system.runInterval(() => {
    t += 5;
    if (t > 200 || !player.isValid) return system.clearRun(id);
    const dist = V.dist(target, player.location);
    const dy = Math.round(target.y - player.location.y);
    const vert = dy > 1 ? ` §e⬆${dy}` : dy < -1 ? ` §e⬇${-dy}` : "";
    actionbar(player, `§d✦ แร่อาร์เคน §f${arrowTo(player, target)} ${Math.round(dist)} บล็อก${vert}`);
    const eye = V.up(player.location, 1.2);
    const dir = V.norm(V.sub(target, eye));
    for (let k = 1; k <= 6; k++) fx.orb(dim, V.add(eye, V.mul(dir, k * 0.8)), COL.arcane, 0.12, 0.3);
    for (const o of found) fx.orb(dim, o, COL.pink, 0.6, 0.3);
    if (dist < 2.5) {
      system.clearRun(id);
      actionbar(player, "§d✦ แร่อยู่ตรงนี้แหละ!");
    }
  }, 5);
}

// ---------- ขุด ----------
export function handleOreBreak(ev) {
  const id = ev.brokenBlockPermutation.type.id;
  const player = ev.player;
  if (isCreative(player)) return;
  const dim = ev.block.dimension;
  const at = { x: ev.block.x + 0.5, y: ev.block.y + 0.5, z: ev.block.z + 0.5 };
  const tool = ev.itemStackBeforeBreak;
  const pick = !!tool && tool.typeId.endsWith("_pickaxe");
  if (id === ORE || id === DEEP_ORE) {
    if (!pick) {
      tell(player, "§7ต้องใช้อีเต้อขุดแร่อาร์เคน");
      return;
    }
    const ench = safe(() => tool.getComponent("minecraft:enchantable"));
    if (safe(() => ench?.getEnchantment("silk_touch"))) {
      safe(() => dim.spawnItem(new ItemStack(id, 1), at));
      return;
    }
    const fortune = safe(() => ench?.getEnchantment("fortune")?.level) ?? 0;
    const n = randInt(ORE_SHARDS[0], ORE_SHARDS[1]) + randInt(0, fortune * 2);
    safe(() => dim.spawnItem(new ItemStack("arc:arcane_shard", n), at));
    for (let i = randInt(2, 4); i > 0; i--) safe(() => dim.spawnEntity("minecraft:xp_orb", at));
    fx.shards(dim, at, COL.arcane, 12, 4);
    sound(dim, "break.amethyst_block", at, 0.8, 1.2);
    const d = getData(player);
    d.st.ore++;
    markDirty(player);
    addXp(player, 5);
    questProgress(player, "mine");
  } else if (id === "minecraft:amethyst_cluster" && chance(AMETHYST_SHARD_CHANCE)) {
    safe(() => dim.spawnItem(new ItemStack("arc:arcane_shard", randInt(1, 2)), at));
    fx.shards(dim, at, COL.arcane, 6, 3);
  } else if (pick && STONE_LIKE.has(id) && chance(STONE_SHARD_CHANCE)) {
    safe(() => dim.spawnItem(new ItemStack("arc:arcane_shard", 1), at));
    fx.shards(dim, at, COL.arcane, 6, 2.5);
    sound(dim, "random.orb", at, 0.4, 1.8);
  }
}

export function initOre() {
  system.runInterval(veinTick, ORE_VEIN_INTERVAL);
}

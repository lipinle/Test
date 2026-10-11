// Smelted Ore Blocks - ขุดแร่แล้วได้ "บล็อก" ของแร่ที่เผาแล้ว
//
// เช่น แร่เหล็ก -> บล็อกเหล็ก, แร่ทอง -> บล็อกทอง, แร่ถ่านหิน -> บล็อกถ่านหิน
//
// หลักการ:
//   1) ก่อนบล็อกแตก (beforeEvents) จดไว้ว่ามีไอเท็มตกอยู่แถวนั้นแล้วกี่ชิ้น
//   2) หลังบล็อกแตก (afterEvents) หาไอเท็มที่ "เพิ่งดรอปใหม่" จากแร่ แล้วลบทิ้ง
//   3) เสกบล็อกของแร่ที่เผาแล้วแทน
//
// ข้อดีของวิธีนี้: เกมยังเช็กเครื่องมือให้เหมือนเดิม (เช่น แร่เพชรต้องใช้อีเตอร์เหล็กขึ้นไป),
// ยังได้ค่า XP, เครื่องมือยังสึกตามปกติ และโหมดสร้างสรรค์จะไม่ดรอปอะไร

import { world, system, ItemStack } from "@minecraft/server";

// ---------- ตั้งค่า ----------

/** แร่ -> บล็อกที่ได้ (ผลจากการเผาแร่ แล้วอัดเป็นบล็อก) */
const ORE_TO_BLOCK = {
  "minecraft:coal_ore": "minecraft:coal_block",
  "minecraft:deepslate_coal_ore": "minecraft:coal_block",

  "minecraft:iron_ore": "minecraft:iron_block",
  "minecraft:deepslate_iron_ore": "minecraft:iron_block",

  "minecraft:copper_ore": "minecraft:copper_block",
  "minecraft:deepslate_copper_ore": "minecraft:copper_block",

  "minecraft:gold_ore": "minecraft:gold_block",
  "minecraft:deepslate_gold_ore": "minecraft:gold_block",
  "minecraft:nether_gold_ore": "minecraft:gold_block",

  "minecraft:redstone_ore": "minecraft:redstone_block",
  "minecraft:deepslate_redstone_ore": "minecraft:redstone_block",
  "minecraft:lit_redstone_ore": "minecraft:redstone_block", // แร่เรดสโตนตอนเรืองแสง
  "minecraft:lit_deepslate_redstone_ore": "minecraft:redstone_block",

  "minecraft:lapis_ore": "minecraft:lapis_block",
  "minecraft:deepslate_lapis_ore": "minecraft:lapis_block",

  "minecraft:diamond_ore": "minecraft:diamond_block",
  "minecraft:deepslate_diamond_ore": "minecraft:diamond_block",

  "minecraft:emerald_ore": "minecraft:emerald_block",
  "minecraft:deepslate_emerald_ore": "minecraft:emerald_block",

  "minecraft:quartz_ore": "minecraft:quartz_block",
};

/** ไอเท็มที่แร่ดรอปตามปกติ (จะถูกลบแล้วแทนด้วยบล็อก) */
const VANILLA_ORE_DROPS = new Set([
  "minecraft:coal",
  "minecraft:raw_iron",
  "minecraft:raw_copper",
  "minecraft:raw_gold",
  "minecraft:gold_nugget",
  "minecraft:redstone",
  "minecraft:lapis_lazuli",
  "minecraft:diamond",
  "minecraft:emerald",
  "minecraft:quartz",
]);

const BLOCKS_PER_ORE = 1; // จำนวนบล็อกที่ได้ต่อแร่ 1 ก้อน
const KEEP_SILK_TOUCH = true; // true = ขุดด้วย Silk Touch ยังได้ตัวแร่เหมือนเดิม
const SEARCH_RADIUS = 1.5; // ระยะค้นหาไอเท็มที่ดรอปรอบจุดที่ขุด

// ---------- ฟังก์ชันช่วย ----------

/** key ของตำแหน่งบล็อก -> id ของไอเท็มที่ตกอยู่ก่อนแล้ว */
const pendingBreaks = new Map();

function locationKey(dimension, { x, y, z }) {
  return `${dimension.id}|${x}|${y}|${z}`;
}

function hasSilkTouch(itemStack) {
  try {
    return itemStack?.getComponent("minecraft:enchantable")?.hasEnchantment("silk_touch") === true;
  } catch {
    return false;
  }
}

function getNearbyItems(dimension, location) {
  return dimension.getEntities({
    type: "minecraft:item",
    location,
    maxDistance: SEARCH_RADIUS,
  });
}

/** ลบไอเท็มที่แร่เพิ่งดรอป แล้วเสกบล็อกแทน คืนค่า true ถ้าทำสำเร็จ */
function replaceDrops(dimension, center, existingIds, blockItemId) {
  const newDrops = getNearbyItems(dimension, center).filter((entity) => {
    if (existingIds.has(entity.id)) return false;
    const itemId = entity.getComponent("minecraft:item")?.itemStack?.typeId;
    return VANILLA_ORE_DROPS.has(itemId);
  });

  // ไม่มีอะไรดรอป = ใช้เครื่องมือผิด หรืออยู่โหมดสร้างสรรค์ -> ไม่ให้บล็อก
  if (newDrops.length === 0) return false;

  for (const entity of newDrops) entity.remove();
  dimension.spawnItem(new ItemStack(blockItemId, BLOCKS_PER_ORE), center);
  return true;
}

// ---------- อีเวนต์ ----------

// ก่อนบล็อกแตก: จดไอเท็มที่ตกอยู่ก่อนแล้ว จะได้ไม่ลบของผู้เล่นทิ้งผิดชิ้น
world.beforeEvents.playerBreakBlock.subscribe((event) => {
  const { block, itemStack } = event;
  if (!ORE_TO_BLOCK[block.typeId]) return;
  if (KEEP_SILK_TOUCH && hasSilkTouch(itemStack)) return;

  // กันหน่วยความจำบวม กรณีการขุดถูกยกเลิกโดย addon อื่น
  if (pendingBreaks.size > 256) pendingBreaks.clear();

  const existingIds = new Set(getNearbyItems(block.dimension, block.center()).map((e) => e.id));
  pendingBreaks.set(locationKey(block.dimension, block.location), existingIds);
});

// หลังบล็อกแตก: แทนที่ของที่ดรอปด้วยบล็อก
world.afterEvents.playerBreakBlock.subscribe((event) => {
  const { block, dimension, brokenBlockPermutation } = event;
  const key = locationKey(dimension, block.location);
  const existingIds = pendingBreaks.get(key);
  if (!existingIds) return;
  pendingBreaks.delete(key);

  const blockItemId = ORE_TO_BLOCK[brokenBlockPermutation.type.id];
  if (!blockItemId) return;

  const center = block.center();
  try {
    if (replaceDrops(dimension, center, existingIds, blockItemId)) return;
  } catch {
    // chunk อาจยังไม่พร้อม ลองใหม่ tick ถัดไป
  }

  // เผื่อเกมเสกไอเท็มช้ากว่าอีเวนต์ 1 tick
  system.run(() => {
    try {
      replaceDrops(dimension, center, existingIds, blockItemId);
    } catch {
      // ผู้เล่นออกจากเกม / chunk ถูก unload
    }
  });
});

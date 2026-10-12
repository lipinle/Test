// ค่าตั้งค่าทั้งหมดของ Smart Mobs — แก้ตัวเลขที่ไฟล์นี้ได้เลย
//
// ระดับ (tier) คำนวณจากจำนวนวันที่ผ่านไปในโลก (world.getDay())
// ยิ่งวันมาก มอนยิ่งได้เกราะ/อาวุธดีขึ้น มีเอฟเฟกต์ และใช้ท่า AI ได้มากขึ้น

/**
 * armorChance   โอกาสได้เกราะ "ต่อชิ้น" (หมวก เสื้อ กางเกง รองเท้า)
 * armor         วัสดุเกราะที่สุ่มได้ (ใส่ซ้ำ = โอกาสมากขึ้น)
 * weaponChance  โอกาสได้อาวุธใหม่
 * melee         อาวุธระยะประชิดที่สุ่มได้
 * enchant       ระดับเอนชานต์สูงสุด (0 = ไม่มี)
 * enchantChance โอกาสที่ไอเท็มแต่ละชิ้นจะติดเอนชานต์
 * trident       โอกาสที่ Drowned จะได้ตรีศูล
 * effects       เอฟเฟกต์ถาวร { id, amp: 0 = I, chance }
 * ai            ความฉลาด (ดู ai.js)
 *   lunge        โอกาสพุ่งกระโจนใส่ผู้เล่นต่อการเช็ก 1 ครั้ง (ทุก 0.5 วินาที)
 *   lungePower   แรงพุ่ง
 *   kite         โอกาสที่มอนยิงธนูจะถอยหนี/หลบข้างเมื่อผู้เล่นเข้าใกล้
 *   dodge        โอกาสหลบข้างหลังโดนผู้เล่นตี
 *   alert        รัศมีเรียกพวก เมื่อมีมอนโดนผู้เล่นตี (0 = ปิด)
 *   packHunt     เมื่อมอนตีโดนผู้เล่น พวกที่อยู่ใกล้จะรุมเข้ามาด้วย
 *   secondWind   เลือดเหลือน้อยแล้วฮึดสู้ (ฟื้นเลือด + เร็วขึ้น) ได้ 1 ครั้ง
 *   jumpUp       กระโดดขึ้นหาผู้เล่นที่ต่อเสาหนี
 *   charged      โอกาส Creeper เกิดมาเป็นแบบชาร์จไฟฟ้า
 */
export const TIERS = [
  {
    day: 0,
    name: "ปกติ",
    armorChance: 0,
    armor: [],
    weaponChance: 0,
    melee: [],
    enchant: 0,
    enchantChance: 0,
    trident: 0,
    effects: [],
    ai: { lunge: 0, lungePower: 0, kite: 0, dodge: 0, alert: 0, packHunt: false, secondWind: false, jumpUp: false, charged: 0 },
  },
  {
    day: 3,
    name: "ตื่นตัว",
    armorChance: 0.2,
    armor: ["leather", "leather", "golden"],
    weaponChance: 0.25,
    melee: ["wooden_sword", "stone_sword", "stone_sword"],
    enchant: 0,
    enchantChance: 0,
    trident: 0,
    effects: [],
    ai: { lunge: 0.15, lungePower: 0.45, kite: 0, dodge: 0, alert: 8, packHunt: false, secondWind: false, jumpUp: false, charged: 0 },
  },
  {
    day: 7,
    name: "นักรบ",
    armorChance: 0.35,
    armor: ["leather", "chainmail", "golden", "iron"],
    weaponChance: 0.4,
    melee: ["stone_sword", "iron_sword", "stone_axe"],
    enchant: 1,
    enchantChance: 0.15,
    trident: 0.05,
    effects: [],
    ai: { lunge: 0.25, lungePower: 0.55, kite: 0.2, dodge: 0.1, alert: 12, packHunt: false, secondWind: false, jumpUp: false, charged: 0 },
  },
  {
    day: 14,
    name: "ทหาร",
    armorChance: 0.5,
    armor: ["chainmail", "iron", "iron"],
    weaponChance: 0.55,
    melee: ["iron_sword", "iron_sword", "iron_axe"],
    enchant: 2,
    enchantChance: 0.3,
    trident: 0.1,
    effects: [{ id: "speed", amp: 0, chance: 0.3 }],
    ai: { lunge: 0.35, lungePower: 0.6, kite: 0.35, dodge: 0.2, alert: 16, packHunt: true, secondWind: true, jumpUp: false, charged: 0.02 },
  },
  {
    day: 21,
    name: "อัศวิน",
    armorChance: 0.65,
    armor: ["iron", "iron", "diamond"],
    weaponChance: 0.7,
    melee: ["iron_sword", "diamond_sword", "iron_axe"],
    enchant: 3,
    enchantChance: 0.45,
    trident: 0.15,
    effects: [
      { id: "speed", amp: 0, chance: 0.4 },
      { id: "strength", amp: 0, chance: 0.3 },
      { id: "health_boost", amp: 0, chance: 0.5 },
    ],
    ai: { lunge: 0.45, lungePower: 0.65, kite: 0.5, dodge: 0.3, alert: 20, packHunt: true, secondWind: true, jumpUp: true, charged: 0.05 },
  },
  {
    day: 30,
    name: "ยอดฝีมือ",
    armorChance: 0.8,
    armor: ["iron", "diamond", "diamond"],
    weaponChance: 0.85,
    melee: ["diamond_sword", "diamond_sword", "diamond_axe"],
    enchant: 4,
    enchantChance: 0.6,
    trident: 0.2,
    effects: [
      { id: "speed", amp: 0, chance: 0.5 },
      { id: "strength", amp: 0, chance: 0.5 },
      { id: "resistance", amp: 0, chance: 0.4 },
      { id: "health_boost", amp: 1, chance: 0.6 },
    ],
    ai: { lunge: 0.55, lungePower: 0.7, kite: 0.6, dodge: 0.4, alert: 24, packHunt: true, secondWind: true, jumpUp: true, charged: 0.1 },
  },
  {
    day: 45,
    name: "ราชันย์",
    armorChance: 0.9,
    armor: ["diamond", "diamond", "netherite"],
    weaponChance: 0.95,
    melee: ["diamond_sword", "netherite_sword", "netherite_axe"],
    enchant: 5,
    enchantChance: 0.75,
    trident: 0.25,
    effects: [
      { id: "speed", amp: 0, chance: 0.6 },
      { id: "strength", amp: 1, chance: 0.5 },
      { id: "resistance", amp: 0, chance: 0.6 },
      { id: "health_boost", amp: 2, chance: 0.7 },
    ],
    ai: { lunge: 0.65, lungePower: 0.75, kite: 0.7, dodge: 0.5, alert: 28, packHunt: true, secondWind: true, jumpUp: true, charged: 0.15 },
  },
  {
    day: 60,
    name: "ฝันร้าย",
    armorChance: 1,
    armor: ["diamond", "netherite", "netherite"],
    weaponChance: 1,
    melee: ["netherite_sword", "netherite_sword", "netherite_axe"],
    enchant: 5,
    enchantChance: 0.9,
    trident: 0.3,
    effects: [
      { id: "speed", amp: 1, chance: 0.6 },
      { id: "strength", amp: 1, chance: 0.7 },
      { id: "resistance", amp: 1, chance: 0.6 },
      { id: "health_boost", amp: 3, chance: 0.8 },
    ],
    ai: { lunge: 0.75, lungePower: 0.8, kite: 0.8, dodge: 0.6, alert: 32, packHunt: true, secondWind: true, jumpUp: true, charged: 0.2 },
  },
];

/** โอกาสที่มอนจะเกิดเป็น "หัวหน้า" ได้ของระดับถัดไป */
export const ELITE_CHANCE = 0.05;

/** โอกาสที่เกราะ/อาวุธที่สคริปต์ใส่ให้จะดรอปเมื่อมอนตาย (กันฟาร์มของฟรี) */
export const GEAR_DROP_CHANCE = 0.085;

/** ความเสียหายของไอเท็มที่ใส่ให้ (สุ่มช่วง 0..ค่านี้ ของความทนทานทั้งหมด) — ของที่ดรอปจะไม่ใหม่เอี่ยม */
export const MAX_GEAR_WEAR = 0.6;

/** ระยะ (บล็อก) ที่ใช้เช็ก AI รอบตัวผู้เล่น */
export const AI_RANGE = 12;

/** ประกาศในแชทเมื่อมอนสเตอร์เลื่อนระดับ */
export const ANNOUNCE_TIER_UP = true;

// ---------------------------------------------------------------------------
// ประเภทมอนสเตอร์
// ---------------------------------------------------------------------------

/**
 * melee     ใส่เกราะ + อาวุธประชิด
 * axe       ใส่เกราะ + ขวาน (Vindicator)
 * drowned   ใส่เกราะ + อาวุธประชิดหรือตรีศูล
 * bow       ใส่เกราะ + ธนูเอนชานต์
 * crossbow  ใส่เกราะ + หน้าไม้เอนชานต์
 * armor     ใส่เกราะอย่างเดียว (ไม่เปลี่ยนอาวุธ)
 * buff      ไม่ใส่เกราะ (ไม่มีโมเดลเกราะ) ได้แค่เอฟเฟกต์
 */
export const MOB_KIND = {
  "minecraft:zombie": "melee",
  "minecraft:husk": "melee",
  "minecraft:zombie_villager": "melee",
  "minecraft:zombie_villager_v2": "melee",
  "minecraft:zombie_pigman": "melee",
  "minecraft:wither_skeleton": "melee",
  "minecraft:vindicator": "axe",
  "minecraft:drowned": "drowned",
  "minecraft:skeleton": "bow",
  "minecraft:stray": "bow",
  "minecraft:bogged": "bow",
  "minecraft:pillager": "crossbow",
  "minecraft:piglin": "armor",
  "minecraft:piglin_brute": "armor",
  "minecraft:creeper": "buff",
  "minecraft:spider": "buff",
  "minecraft:cave_spider": "buff",
  "minecraft:witch": "buff",
  "minecraft:evoker": "buff",
  "minecraft:enderman": "buff",
  "minecraft:silverfish": "buff",
  "minecraft:endermite": "buff",
  "minecraft:slime": "buff",
  "minecraft:magma_cube": "buff",
  "minecraft:blaze": "buff",
  "minecraft:ghast": "buff",
  "minecraft:phantom": "buff",
  "minecraft:hoglin": "buff",
  "minecraft:zoglin": "buff",
  "minecraft:ravager": "buff",
  "minecraft:vex": "buff",
  "minecraft:breeze": "buff",
  "minecraft:guardian": "buff",
};

/** มอนที่พุ่งกระโจนใส่ผู้เล่นได้ */
export const LUNGERS = new Set([
  "minecraft:zombie",
  "minecraft:husk",
  "minecraft:zombie_villager",
  "minecraft:zombie_villager_v2",
  "minecraft:drowned",
  "minecraft:wither_skeleton",
  "minecraft:vindicator",
  "minecraft:piglin_brute",
  "minecraft:zoglin",
  "minecraft:spider",
  "minecraft:cave_spider",
]);

/** มอนยิงไกลที่ถอยหนี/หลบข้างได้ */
export const KITERS = new Set([
  "minecraft:skeleton",
  "minecraft:stray",
  "minecraft:bogged",
  "minecraft:pillager",
]);

/** มอนที่ถูกเรียกมารุมได้ (ไม่รวมมอนกลาง ๆ อย่าง Enderman / Zombified Piglin / Piglin) */
export const ALERTABLE = new Set([
  "minecraft:zombie",
  "minecraft:husk",
  "minecraft:zombie_villager",
  "minecraft:zombie_villager_v2",
  "minecraft:drowned",
  "minecraft:skeleton",
  "minecraft:stray",
  "minecraft:bogged",
  "minecraft:wither_skeleton",
  "minecraft:creeper",
  "minecraft:spider",
  "minecraft:cave_spider",
  "minecraft:pillager",
  "minecraft:vindicator",
  "minecraft:witch",
  "minecraft:evoker",
]);

/** แมงมุมเป็นกลางตอนกลางวัน — ไม่ให้พุ่ง/ถูกเรียกรุมตอนกลางวัน */
export const NIGHT_ONLY = new Set(["minecraft:spider", "minecraft:cave_spider"]);

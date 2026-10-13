// ===== Arcane Ascension — ค่าตั้งต้นทั้งหมด (แก้ตัวเลขที่นี่ได้เลย) =====

export const DIMENSION_ID = "arc:the_rift"; // มิติใหม่ที่สร้างด้วย Script API (void generator)

// ---------- เลเวล / ค่าสถานะ ----------
export const MAX_LEVEL = 50;
export const POINTS_PER_LEVEL = 3;
export const xpToNext = (lvl) => Math.floor(60 * Math.pow(lvl, 1.55) + 40);

export const ATTRS = {
  int: { name: "สติปัญญา", short: "INT", color: "§d", desc: "+4% พลังเวททุกคาถา" },
  wis: { name: "ปัญญาญาณ", short: "WIS", color: "§b", desc: "+10 มานาสูงสุด, +0.35 มานา/วินาที" },
  vit: { name: "พลังชีวิต", short: "VIT", color: "§c", desc: "ทุก 3 แต้ม = หัวใจเพิ่ม 2 ดวง (สูงสุด +20 ดวง)" },
  cel: { name: "ความเร็วร่ายเวท", short: "CEL", color: "§e", desc: "-1% คูลดาวน์คาถา (ลดได้สูงสุด 40%)" },
};

// ---------- มานา ----------
export const BASE_MANA = 100;
export const MANA_PER_WIS = 10;
export const MANA_PER_LEVEL = 2;
export const BASE_REGEN = 2; // ต่อวินาที
export const REGEN_PER_WIS = 0.35;

// ---------- ธาตุ ----------
export const ELEMENTS = {
  arcane: { name: "อาร์เคน", c: "§d", rgb: { red: 0.72, green: 0.45, blue: 1 } },
  fire: { name: "เพลิง", c: "§6", rgb: { red: 1, green: 0.45, blue: 0.1 } },
  frost: { name: "น้ำแข็ง", c: "§b", rgb: { red: 0.55, green: 0.92, blue: 1 } },
  storm: { name: "พายุ", c: "§e", rgb: { red: 1, green: 0.9, blue: 0.3 } },
  void: { name: "ความว่างเปล่า", c: "§5", rgb: { red: 0.8, green: 0.25, blue: 1 } },
  nature: { name: "ชีวิต", c: "§a", rgb: { red: 0.4, green: 1, blue: 0.5 } },
};

// ---------- คาถา ----------
// level = เลเวลที่ต้องมี, cost = เศษผลึกอาร์เคนที่ใช้เรียน, mana = มานาที่ใช้, cd = คูลดาวน์ (tick)
export const SPELLS = {
  arcane_bolt: { name: "ลูกศรเวท", element: "arcane", level: 1, cost: 0, mana: 8, cd: 10, glyph: "", desc: "ยิงลูกศรพลังเวทที่เลี้ยวตามศัตรูเอง" },
  fireball: { name: "ลูกไฟระเบิด", element: "fire", level: 3, cost: 8, mana: 20, cd: 30, glyph: "", desc: "ลูกไฟระเบิดเป็นวงกว้าง เผาทุกตัวในรัศมี 3 บล็อก (ไม่ทำลายบล็อก)" },
  frost_nova: { name: "วงแหวนน้ำแข็ง", element: "frost", level: 5, cost: 12, mana: 25, cd: 120, glyph: "", desc: "ระเบิดความเย็นรอบตัว 7 บล็อก ศัตรูช้าลงอย่างหนัก" },
  blink: { name: "เคลื่อนย้ายพริบตา", element: "arcane", level: 7, cost: 12, mana: 15, cd: 60, glyph: "", desc: "วาร์ปไปข้างหน้าสูงสุด 12 บล็อก ไม่ทะลุกำแพง" },
  chain_lightning: { name: "สายฟ้าลูกโซ่", element: "storm", level: 10, cost: 16, mana: 30, cd: 80, glyph: "", desc: "สายฟ้ากระโดดจากศัตรูตัวหนึ่งไปอีกหลายตัว" },
  healing_circle: { name: "วงเวทฟื้นฟู", element: "nature", level: 12, cost: 16, mana: 35, cd: 300, glyph: "", desc: "วงเวทบนพื้น 8 วินาที รักษาผู้เล่นและสัตว์เลี้ยงในวง" },
  spirit_wolves: { name: "หมาป่าวิญญาณ", element: "nature", level: 15, cost: 20, mana: 40, cd: 600, glyph: "", desc: "อัญเชิญหมาป่าวิญญาณ 2-3 ตัวมาช่วยสู้ 40 วินาที" },
  meteor: { name: "อุกกาบาต", element: "fire", level: 18, cost: 24, mana: 50, cd: 400, glyph: "", desc: "เรียกอุกกาบาตจากฟ้าตกใส่จุดที่มอง ระเบิดรัศมี 5 บล็อก" },
  black_hole: { name: "หลุมดำ", element: "void", level: 22, cost: 28, mana: 60, cd: 500, glyph: "", desc: "หลุมดำดูดศัตรูเข้าหาศูนย์กลาง 4 วินาทีแล้วระเบิด" },
  storm_call: { name: "พายุคลั่ง", element: "storm", level: 26, cost: 32, mana: 70, cd: 700, glyph: "", desc: "สายฟ้าฟาดศัตรูรอบตัวต่อเนื่อง 6 วินาที" },
  time_stop: { name: "หยุดเวลา", element: "void", level: 30, cost: 40, mana: 90, cd: 1200, glyph: "", desc: "หยุดเวลาทุกอย่างรอบตัว 16 บล็อก 6 วินาที ดาเมจที่ทำระหว่างนั้นจะระเบิดออกมา x1.5" },
  cataclysm: { name: "มหาวิบัติอาร์เคน", element: "arcane", level: 40, cost: 64, mana: 150, cd: 2400, glyph: "", desc: "สุดยอดเวท: ลอยขึ้นร่ายเวท แล้วลำแสงอาร์เคน 16 สายถล่มรอบตัว" },
};
export const SPELL_ORDER = Object.keys(SPELLS);

// ---------- คทา ----------
// power = ตัวคูณพลังเวท, element = ธาตุที่ถนัด (+40%), mana = ตัวคูณมานาที่ใช้
export const STAFFS = {
  "arc:apprentice_staff": { power: 1.0, element: null, mana: 1.0 },
  "arc:ember_staff": { power: 1.3, element: "fire", mana: 1.0 },
  "arc:frost_staff": { power: 1.3, element: "frost", mana: 1.0 },
  "arc:storm_staff": { power: 1.3, element: "storm", mana: 1.0 },
  "arc:void_staff": { power: 1.55, element: "void", mana: 0.95 },
  "arc:archmage_staff": { power: 1.9, element: "all", mana: 0.8 },
};
export const ELEMENT_BONUS = 1.4;
export const ARCHMAGE_ALL_BONUS = 1.15;

// ---------- อาวุธรูน ----------
export const RUNES = {
  "arc:rune_fire": { key: "fire", name: "รูนเพลิง", c: "§c", glyph: "", desc: "ติดไฟ 4 วิ + ดาเมจไฟเพิ่ม" },
  "arc:rune_frost": { key: "frost", name: "รูนเยือกแข็ง", c: "§b", glyph: "", desc: "ศัตรูช้าลงอย่างหนัก 3 วิ" },
  "arc:rune_storm": { key: "storm", name: "รูนพายุ", c: "§e", glyph: "", desc: "20% สายฟ้าฟาดเป้าและศัตรูข้าง ๆ" },
  "arc:rune_leech": { key: "leech", name: "รูนดูดเลือด", c: "§4", glyph: "", desc: "ฟื้นเลือด 20% ของดาเมจที่ทำ" },
};
export const RUNE_SOCKETS = { "arc:runeblade": 3, "arc:void_reaver": 2 }; // อาวุธอื่นใส่ได้ 1 ช่อง
export const RUNE_WEAPON_SUFFIX = ["_sword", "_axe", "_spear", "mace", "trident"];

// ---------- XP จากการฆ่า ----------
export const KILL_XP = {
  "arc:void_wraith": 25,
  "arc:crystal_golem": 45,
  "arc:ember_imp": 20,
  "arc:rift_stalker": 30,
  "arc:void_crystal": 15,
  "arc:ember_colossus": 700,
  "arc:void_titan": 1800,
  "minecraft:ender_dragon": 1500,
  "minecraft:wither": 900,
  "minecraft:warden": 500,
  "minecraft:elder_guardian": 200,
  "minecraft:evocation_illager": 60,
  "minecraft:ravager": 60,
  "minecraft:enderman": 18,
  "minecraft:blaze": 15,
  "minecraft:breeze": 20,
};
export const MONSTER_XP = 8;
export const OTHER_XP = 1;

// ---------- สมุดบันทึกสัตว์ประหลาด ----------
export const BESTIARY = [
  { id: "arc:void_wraith", name: "วิญญาณแห่งความว่างเปล่า", lore: "ลอยทะลุกำแพงได้ ออกตอนกลางคืน ยิงลูกเวทสีม่วง ดรอปแก่นแท้ความว่างเปล่า" },
  { id: "arc:crystal_golem", name: "โกเลมผลึก", lore: "อาศัยในถ้ำลึก (Y < 10) อึดและตีแรง เมื่อเลือดเหลือครึ่งจะระเบิดผลึก ดรอปเศษผลึกและหัวใจผลึก" },
  { id: "arc:ember_imp", name: "อิมพ์เพลิง", lore: "ปีศาจตัวเล็กในเนเธอร์ กระโดดใส่และขว้างลูกไฟ ดรอปแกนถ่านเพลิง" },
  { id: "arc:rift_stalker", name: "นักล่ารอยแยก", lore: "พบในรอยแยกมิติเท่านั้น วาร์ปไปด้านหลังเป้าหมายแล้วฟันด้วยใบมีด" },
  { id: "arc:void_crystal", name: "ผลึกโล่ความว่างเปล่า", lore: "ผลึกที่ไททันเรียกออกมาปกป้องตัวเอง ต้องทำลายทุกก้อนถึงจะทำร้ายไททันได้" },
  { id: "arc:ember_colossus", name: "ยักษ์เพลิงโคลอสซัส", lore: "บอส: ทุบพื้น ขว้างลูกไฟ ทำให้ลาวาปะทุใต้เท้า คลั่งเมื่อเลือดเหลือครึ่ง" },
  { id: "arc:void_titan", name: "ไททันแห่งความว่างเปล่า", lore: "บอสสุดท้าย 3 ระยะ: ลูกเวทติดตาม, โล่ผลึก, ลำแสงความว่างเปล่าและฝนอุกกาบาต" },
];

// ---------- ภารกิจ ----------
// type: cast / mine / learn / kill (target = entity id) / waystone / rift (target = tier) / bloodmoon / level / boss / spell (target = spell id)
export const QUESTS = [
  { id: "first_cast", name: "ก้าวแรกของจอมเวท", desc: "ร่ายเวท 10 ครั้ง", type: "cast", count: 10, xp: 100, items: [["arc:mana_potion", 3]] },
  { id: "miner", name: "นักขุดอาร์เคน", desc: "ขุดแร่อาร์เคน 10 ก้อน", type: "mine", count: 10, xp: 150, items: [["arc:arcane_ingot", 2]] },
  { id: "student", name: "ศิษย์คัมภีร์", desc: "เรียนคาถาใหม่ 1 อย่าง", type: "learn", count: 1, xp: 120, items: [["arc:arcane_shard", 8]] },
  { id: "wraith_hunt", name: "ล่าวิญญาณ", desc: "กำจัดวิญญาณแห่งความว่างเปล่า 10 ตัว", type: "kill", target: "arc:void_wraith", count: 10, xp: 300, items: [["arc:rune_leech", 1]] },
  { id: "golem_hunt", name: "ทุบผลึก", desc: "กำจัดโกเลมผลึก 3 ตัว", type: "kill", target: "arc:crystal_golem", count: 3, xp: 300, items: [["arc:crystal_heart", 1]] },
  { id: "imp_hunt", name: "ดับไฟใต้พิภพ", desc: "กำจัดอิมพ์เพลิง 15 ตัว", type: "kill", target: "arc:ember_imp", count: 15, xp: 300, items: [["arc:rune_fire", 1]] },
  { id: "pathmaker", name: "ผู้สร้างเส้นทาง", desc: "วางหินวาร์ป 2 ก้อน", type: "waystone", count: 2, xp: 200, items: [["arc:arcane_shard", 12]] },
  { id: "rift_1", name: "ผู้บุกเบิกรอยแยก", desc: "พิชิตรอยแยกมิติระดับ I", type: "rift", target: 1, count: 1, xp: 500, items: [["arc:rift_key", 1]] },
  { id: "blood_moon", name: "รอดใต้จันทร์สีเลือด", desc: "กำจัดมอนสเตอร์ 20 ตัวระหว่างจันทร์สีเลือด", type: "bloodmoon", count: 20, xp: 500, items: [["arc:rune_storm", 1]] },
  { id: "adept", name: "ผู้ชำนาญธาตุ", desc: "ขึ้นถึงเลเวล 15", type: "level", count: 15, xp: 400, items: [["arc:rune_frost", 1]] },
  { id: "colossus", name: "ล้มยักษ์เพลิง", desc: "ปราบยักษ์เพลิงโคลอสซัส", type: "boss", target: "arc:ember_colossus", count: 1, xp: 1000, items: [["arc:greater_mana_potion", 3]] },
  { id: "rift_2", name: "ดำดิ่งสู่รอยแยก", desc: "พิชิตรอยแยกมิติระดับ II", type: "rift", target: 2, count: 1, xp: 800, items: [["arc:rift_key", 2]] },
  { id: "chronomancer", name: "ผู้หยุดกาลเวลา", desc: "เรียนคาถาหยุดเวลา", type: "spell", target: "time_stop", count: 1, xp: 600, items: [["arc:void_essence", 10]] },
  { id: "titan", name: "ผู้พิชิตความว่างเปล่า", desc: "ปราบไททันแห่งความว่างเปล่า", type: "boss", target: "arc:void_titan", count: 1, xp: 3000, items: [["arc:titan_heart", 1]] },
  { id: "archmage", name: "อาร์คเมจ", desc: "ขึ้นถึงเลเวล 40", type: "level", count: 40, xp: 2000, items: [["arc:greater_mana_potion", 5]] },
];

// ---------- สูตรแท่นบูชา (Infusion) ----------
export const ALTAR_RECIPES = [
  { result: "arc:ember_staff", level: 5, needs: [["arc:apprentice_staff", 1], ["arc:ember_core", 4], ["arc:arcane_shard", 8]] },
  { result: "arc:frost_staff", level: 5, needs: [["arc:apprentice_staff", 1], ["minecraft:blue_ice", 4], ["arc:arcane_shard", 8]] },
  { result: "arc:storm_staff", level: 5, needs: [["arc:apprentice_staff", 1], ["minecraft:copper_ingot", 6], ["minecraft:lightning_rod", 1], ["arc:arcane_shard", 8]] },
  { result: "arc:void_staff", level: 15, needs: [["arc:apprentice_staff", 1], ["arc:void_essence", 8], ["minecraft:ender_eye", 2], ["arc:arcane_ingot", 4]] },
  { result: "arc:archmage_staff", level: 30, needs: [["arc:void_staff", 1], ["arc:titan_heart", 1], ["arc:arcane_ingot", 8]] },
  { result: "arc:runeblade", level: 8, needs: [["minecraft:diamond_sword", 1], ["arc:arcane_ingot", 4], ["arc:crystal_heart", 1]] },
  { result: "arc:rune_fire", level: 5, needs: [["arc:ember_core", 3], ["arc:arcane_ingot", 1]] },
  { result: "arc:rune_frost", level: 5, needs: [["minecraft:blue_ice", 2], ["minecraft:snowball", 4], ["arc:arcane_ingot", 1]] },
  { result: "arc:rune_storm", level: 5, needs: [["minecraft:lightning_rod", 1], ["minecraft:copper_ingot", 4], ["arc:arcane_ingot", 1]] },
  { result: "arc:rune_leech", level: 5, needs: [["arc:void_essence", 3], ["minecraft:ghast_tear", 1], ["arc:arcane_ingot", 1]] },
  { result: "arc:archmage_hood", level: 10, needs: [["minecraft:leather_helmet", 1], ["arc:arcane_ingot", 5]] },
  { result: "arc:archmage_robe", level: 10, needs: [["minecraft:leather_chestplate", 1], ["arc:arcane_ingot", 8]] },
  { result: "arc:archmage_leggings", level: 10, needs: [["minecraft:leather_leggings", 1], ["arc:arcane_ingot", 7]] },
  { result: "arc:archmage_boots", level: 10, needs: [["minecraft:leather_boots", 1], ["arc:arcane_ingot", 4]] },
  { result: "arc:voidplate_helmet", level: 20, needs: [["minecraft:diamond_helmet", 1], ["arc:void_essence", 6], ["arc:crystal_heart", 1]] },
  { result: "arc:voidplate_chestplate", level: 20, needs: [["minecraft:diamond_chestplate", 1], ["arc:void_essence", 10], ["arc:crystal_heart", 2]] },
  { result: "arc:voidplate_leggings", level: 20, needs: [["minecraft:diamond_leggings", 1], ["arc:void_essence", 8], ["arc:crystal_heart", 1]] },
  { result: "arc:voidplate_boots", level: 20, needs: [["minecraft:diamond_boots", 1], ["arc:void_essence", 5], ["arc:crystal_heart", 1]] },
  { result: "arc:greater_mana_potion", count: 2, level: 8, needs: [["arc:mana_potion", 2], ["arc:void_essence", 1]] },
  { result: "arc:ember_sigil", level: 15, needs: [["arc:ember_core", 8], ["minecraft:blaze_rod", 2], ["arc:arcane_ingot", 2]] },
  { result: "arc:void_sigil", level: 25, needs: [["arc:void_essence", 12], ["arc:crystal_heart", 2], ["arc:arcane_ingot", 4]] },
  { result: "arc:rift_key", count: 2, level: 5, needs: [["arc:void_essence", 2], ["arc:arcane_ingot", 1], ["minecraft:ender_pearl", 1]] },
];

// ---------- ชุดเกราะ ----------
export const ARMOR_SETS = {
  archmage: { name: "ชุดอาร์คเมจ", prefix: "arc:archmage_", manaPerPiece: 15, powerPerPiece: 0.05, full: "มานาฟื้นเร็วขึ้น 75%, ใช้มานาน้อยลง 15%" },
  voidplate: { name: "ชุดเกราะความว่างเปล่า", prefix: "arc:voidplate_", reducePerPiece: 0.05, full: "ต้านทาน I ตลอดเวลา, ไม่รับดาเมจตก, เคลื่อนย้ายพริบตาไม่ใช้มานา" },
};

// ---------- รอยแยกมิติ ----------
export const RIFT_TIERS = {
  1: {
    name: "I", level: 1, requires: 0, color: "§d",
    mobs: ["minecraft:zombie", "minecraft:skeleton", "minecraft:spider", "arc:rift_stalker", "arc:void_wraith"],
    perRoom: 3, waves: 1, effects: [],
    boss: "arc:crystal_golem", eliteBoss: true,
  },
  2: {
    name: "II", level: 12, requires: 1, color: "§6",
    mobs: ["arc:rift_stalker", "arc:ember_imp", "minecraft:blaze", "minecraft:wither_skeleton", "arc:void_wraith", "minecraft:husk"],
    perRoom: 4, waves: 2, effects: [["strength", 0], ["resistance", 0]],
    boss: "arc:ember_colossus",
  },
  3: {
    name: "III", level: 25, requires: 2, color: "§5",
    mobs: ["arc:rift_stalker", "arc:void_wraith", "arc:crystal_golem", "minecraft:enderman", "minecraft:wither_skeleton", "minecraft:evocation_illager"],
    perRoom: 5, waves: 2, effects: [["strength", 1], ["resistance", 0], ["speed", 0]],
    boss: "arc:void_titan",
  },
};
export const RIFT_COLLAPSE_SECONDS = 120; // หลังพิชิตบอส รอยแยกจะพังลงภายในกี่วินาที
export const RIFT_ABANDON_SECONDS = 180; // ไม่มีใครอยู่ในรอยแยกนานเท่านี้ -> พังทลาย

// รางวัลหีบสมบัติในรอยแยก [itemId, min, max, weight]
export const RIFT_LOOT = {
  1: [["arc:arcane_shard", 4, 10, 30], ["arc:mana_potion", 1, 3, 20], ["minecraft:iron_ingot", 3, 8, 20], ["minecraft:gold_ingot", 2, 6, 15],
    ["arc:void_essence", 1, 3, 15], ["minecraft:diamond", 1, 2, 8], ["arc:arcane_ingot", 1, 2, 10], ["minecraft:ender_pearl", 1, 3, 10]],
  2: [["arc:arcane_ingot", 2, 5, 25], ["arc:void_essence", 2, 5, 20], ["arc:ember_core", 2, 5, 20], ["arc:greater_mana_potion", 1, 2, 15],
    ["minecraft:diamond", 2, 4, 15], ["arc:crystal_heart", 1, 1, 8], ["arc:rift_key", 1, 1, 8], ["minecraft:emerald", 4, 10, 10]],
  3: [["arc:arcane_ingot", 4, 8, 25], ["arc:void_essence", 4, 10, 20], ["arc:crystal_heart", 1, 2, 15], ["arc:greater_mana_potion", 2, 4, 15],
    ["minecraft:diamond", 3, 6, 15], ["minecraft:netherite_scrap", 1, 3, 10], ["arc:rift_key", 1, 2, 10], ["minecraft:totem_of_undying", 1, 1, 4]],
};

// ---------- จันทร์สีเลือด ----------
export const BLOOD_MOON_EVERY = 7; // ทุก ๆ กี่คืน (คืนที่ 7, 14, 21 ...)
export const BLOOD_MOON_RANDOM = 0.08; // หรือสุ่มโอกาสต่อคืน
export const BLOOD_MOON_MOBS = ["minecraft:zombie", "minecraft:skeleton", "minecraft:spider", "minecraft:husk", "arc:void_wraith", "minecraft:creeper"];
export const BLOOD_MOON_MAX_PER_PLAYER = 10;

// ---------- อื่น ๆ ----------
export const WAYSTONE_MANA_COST = 20;
export const DAMAGE_TEXT_MAX = 40;
export const PROJECTILE_MAX = 80;

export const DEFAULT_SETTINGS = { hud: true, glyph: true, dmg: true, cine: true, shake: true };
export const DEFAULT_WORLD = { bloodMoon: true, pvp: false, realLightning: false };

// ไอคอนฟอนต์ (RP/font/glyph_E5.png)
export const G = {
  MANA: "", MANA_HALF: "", MANA_EMPTY: "", XP: "", XP_EMPTY: "",
  HEART: "", STAR: "", SKULL: "", SHARD: "", MOON: "", CLOCK: "",
  SWORD: "", SHIELD: "", BOLT: "", PORTAL: "", CHECK: "", LOCK: "",
  HP: "", HP_EMPTY: "",
};

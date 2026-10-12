// ค่าตั้งต้นทั้งหมดของ RPG Levels — แก้ตัวเลขในไฟล์นี้เพื่อปรับสมดุลเกม

export const MENU_ITEM = "rpg:status_book";

export const MAX_LEVEL = 100;
export const MAX_STAT = 100; // ค่าสถานะแต่ละตัวอัพได้สูงสุด
export const MAX_PROF_LEVEL = 50;
export const POINTS_PER_LEVEL = 3;
export const BONUS_POINTS_EVERY = 10; // ทุก ๆ 10 เลเวล
export const BONUS_POINTS = 5; // ได้แต้มพิเศษเพิ่ม
export const RESET_COST_LEVELS = 10; // รีเซ็ตแต้มสถานะ ใช้เลเวล XP ปกติของเกม

/** XP ที่ต้องใช้จากเลเวล level ไป level + 1 */
export function xpToNext(level) {
  return Math.floor(20 * Math.pow(level, 1.4) + 80);
}

/** XP ความชำนาญที่ต้องใช้จากเลเวล level ไป level + 1 */
export function profXpToNext(level) {
  return Math.floor(25 * Math.pow(level + 1, 1.3) + 25);
}

/** ฉายาตามเลเวล (เรียงจากสูงไปต่ำ) */
export const RANKS = [
  { level: 100, name: "§c§lเทพเจ้า" },
  { level: 80, name: "§dตำนาน" },
  { level: 60, name: "§6ปรมาจารย์" },
  { level: 45, name: "§5ยอดฝีมือ" },
  { level: 30, name: "§9ผู้กล้า" },
  { level: 20, name: "§bนักรบ" },
  { level: 10, name: "§aนักผจญภัย" },
  { level: 1, name: "§7มือใหม่" },
];

export function rankOf(level) {
  return (RANKS.find((r) => level >= r.level) ?? RANKS[RANKS.length - 1]).name;
}

// ---------------------------------------------------------------------------
// ค่าสถานะตัวละคร
// ---------------------------------------------------------------------------

export const STATS = {
  str: {
    name: "พลังโจมตี (STR)",
    color: "§c",
    icon: "textures/items/iron_sword",
    desc: "+0.2 ดาเมจระยะประชิดต่อแต้ม",
  },
  vit: {
    name: "พลังชีวิต (VIT)",
    color: "§4",
    icon: "textures/items/apple_golden",
    desc: "ทุก 10 แต้ม เลือดสูงสุด +2 หัวใจ และฟื้นเลือดเองเรื่อย ๆ",
  },
  def: {
    name: "ป้องกัน (DEF)",
    color: "§9",
    icon: "textures/items/iron_chestplate",
    desc: "ลดดาเมจที่ได้รับ 0.5% ต่อแต้ม (สูงสุด 50%)",
  },
  agi: {
    name: "ความว่องไว (AGI)",
    color: "§a",
    icon: "textures/items/feather",
    desc: "หลบการโจมตี 0.25%/แต้ม, ทุก 30 แต้มได้ความเร็ว +1 ระดับ",
  },
  dex: {
    name: "ความแม่นยำ (DEX)",
    color: "§e",
    icon: "textures/items/bow_standby",
    desc: "โอกาสคริติคอล 0.5%/แต้ม, แรงคริ และดาเมจธนูเพิ่ม",
  },
  luk: {
    name: "โชค (LUK)",
    color: "§d",
    icon: "textures/items/emerald",
    desc: "โอกาสแร่ดรอปคู่ 0.5%/แต้ม และ XP ที่ได้ +0.5%/แต้ม",
  },
};

export const STAT_IDS = /** @type {(keyof typeof STATS)[]} */ (Object.keys(STATS));

/** สูตรผลของค่าสถานะ — ใช้ทั้งในระบบจริงและหน้าแสดงผล */
export const statFx = {
  meleeBonus: (s) => s.str * 0.2,
  maxHpBonus: (s) => Math.floor(s.vit / 10) * 4,
  regenPerSec: (s) => s.vit * 0.005,
  reduction: (s) => Math.min(0.5, s.def * 0.005),
  dodge: (s) => Math.min(0.25, s.agi * 0.0025),
  speedLevel: (s) => Math.floor(s.agi / 30),
  critChance: (s) => Math.min(0.5, 0.05 + s.dex * 0.005),
  critMult: (s) => 1.5 + s.dex * 0.005,
  projBonus: (s) => s.dex * 0.005,
  doubleDrop: (s) => Math.min(0.5, s.luk * 0.005),
  xpBonus: (s) => s.luk * 0.005,
};

// ---------------------------------------------------------------------------
// ความชำนาญอุปกรณ์ / อาวุธ — ถึงเลเวลที่กำหนดจะได้เอฟเฟกต์พิเศษ
// ---------------------------------------------------------------------------

export const PROFS = {
  sword: {
    name: "ดาบ",
    icon: "textures/items/diamond_sword",
    how: "ตีศัตรูด้วยดาบ",
    perks: [
      { level: 10, text: "ดาเมจดาบ +10%" },
      { level: 20, text: "ดูดเลือด 8% ของดาเมจ" },
      { level: 30, text: "ฟันกวาด: ศัตรูรอบเป้าหมายโดน 35% ของดาเมจ" },
      { level: 40, text: "เลือดออก: 25% ใส่ Wither 3 วินาที" },
      { level: 50, text: "ประหาร: เป้าหมายเลือดต่ำกว่า 15% ตายทันที (ยกเว้นบอส) + คริ +10%" },
    ],
  },
  axe: {
    name: "ขวาน",
    icon: "textures/items/diamond_axe",
    how: "ตีศัตรูหรือตัดไม้ด้วยขวาน",
    perks: [
      { level: 10, text: "ดาเมจขวาน +10%" },
      { level: 20, text: "ตัดไม้ไว: ได้ Haste I ขณะถือขวาน" },
      { level: 30, text: "ทลายเกราะ: ศัตรูที่โดนติด Weakness 4 วินาที" },
      { level: 40, text: "คนตัดไม้: 30% ได้ไม้ท่อนเพิ่ม 1" },
      { level: 50, text: "สะท้าน: ดาเมจ +25% และ 20% ทำให้ศัตรูมึน (Slowness IV 2 วิ)" },
    ],
  },
  pickaxe: {
    name: "อีเตอร์",
    icon: "textures/items/diamond_pickaxe",
    how: "ขุดหินและแร่ด้วยอีเตอร์",
    perks: [
      { level: 10, text: "Haste I ขณะถืออีเตอร์" },
      { level: 20, text: "นักขุด: แร่มีโอกาสดรอปคู่ +15%" },
      { level: 30, text: "Haste II ขณะถืออีเตอร์" },
      { level: 40, text: "ได้ XP ปกติของเกมจากแร่เพิ่มเป็น 2 เท่า" },
      { level: 50, text: "ตำนานนักขุด: 10% แร่ดรอป 3 เท่า, ขุดแร่ทั้งสายได้เพิ่มอีก 64 บล็อก" },
    ],
  },
  shovel: {
    name: "พลั่ว",
    icon: "textures/items/diamond_shovel",
    how: "ขุดดิน ทราย กรวด หิมะ ด้วยพลั่ว",
    perks: [
      { level: 10, text: "Haste I ขณะถือพลั่ว" },
      { level: 20, text: "ล่าสมบัติ: 2% เจอของมีค่าในดิน" },
      { level: 30, text: "Haste II ขณะถือพลั่ว" },
      { level: 40, text: "ล่าสมบัติขั้นสูง: 4% และมีโอกาสเจอเพชร/มรกต" },
      { level: 50, text: "ขุด 3x3: ย่อตัวขณะขุดจะขุดทีละ 9 บล็อก" },
    ],
  },
  hoe: {
    name: "จอบ (การเกษตร)",
    icon: "textures/items/diamond_hoe",
    how: "เก็บพืชที่โตเต็มที่ด้วยจอบ",
    perks: [
      { level: 10, text: "25% ได้ผลผลิตเพิ่ม" },
      { level: 20, text: "ปลูกใหม่อัตโนมัติหลังเก็บเกี่ยว" },
      { level: 30, text: "ออร่าเร่งโต: ถือจอบแล้วพืชรอบตัวโตเร็วขึ้น" },
      { level: 40, text: "40% ผลผลิตเป็น 2 เท่า" },
      { level: 50, text: "เก็บเกี่ยว 3x3 ในครั้งเดียว" },
    ],
  },
  bow: {
    name: "ธนู / หน้าไม้",
    icon: "textures/items/bow_standby",
    how: "ยิงโดนศัตรูด้วยธนูหรือหน้าไม้",
    perks: [
      { level: 10, text: "ดาเมจลูกธนู +15%" },
      { level: 20, text: "30% ไม่เสียลูกธนู" },
      { level: 30, text: "ลูกธนูทำให้ช้า (Slowness II 3 วิ)" },
      { level: 40, text: "เล็งจุดตาย: 20% ดาเมจ +50%" },
      { level: 50, text: "ลูกธนูเพลิง: เป้าหมายติดไฟ 5 วิ และดาเมจ +25%" },
    ],
  },
  trident: {
    name: "ตรีศูล",
    icon: "textures/items/trident",
    how: "แทงหรือขว้างตรีศูลโดนศัตรู",
    perks: [
      { level: 10, text: "ดาเมจตรีศูล +15%" },
      { level: 20, text: "Dolphin's Grace ขณะถือตรีศูล" },
      { level: 30, text: "20% เรียกสายฟ้าเมื่อขว้างโดน" },
      { level: 40, text: "Conduit Power ขณะถือตรีศูล" },
      { level: 50, text: "เจ้าสมุทร: ดาเมจ +30% และสายฟ้า 40%" },
    ],
  },
  armor: {
    name: "เกราะ",
    icon: "textures/items/diamond_chestplate",
    how: "ใส่เกราะแล้วรับการโจมตี",
    perks: [
      { level: 10, text: "ลดดาเมจเพิ่ม 5%" },
      { level: 20, text: "หนาม: สะท้อนดาเมจระยะประชิด 20%" },
      { level: 30, text: "โล่ฉุกเฉิน: เลือดต่ำกว่า 30% ได้ Absorption II (คูลดาวน์ 60 วิ)" },
      { level: 40, text: "ลดดาเมจเพิ่มรวม 15%" },
      { level: 50, text: "ไม่ยอมตาย: เลือดต่ำกว่า 20% ฟื้นเป็น 50% + Resistance III (คูลดาวน์ 5 นาที)" },
    ],
  },
};

export const PROF_IDS = /** @type {(keyof typeof PROFS)[]} */ (Object.keys(PROFS));

// ---------------------------------------------------------------------------
// สกิลพิเศษ — ปลดล็อกตามเลเวลตัวละคร แล้วเปิด/ปิดเองได้ในเมนู
// ---------------------------------------------------------------------------

export const SKILLS = [
  { id: "night_vision", level: 3, name: "มองในที่มืด", icon: "textures/items/ender_eye", desc: "มองเห็นชัดในที่มืดและใต้น้ำ" },
  { id: "magnet", level: 5, name: "แม่เหล็ก", icon: "textures/items/iron_ingot", desc: "ดูดไอเท็มและลูกแก้ว XP รอบตัวเข้าหา (ย่อตัว = หยุดดูดชั่วคราว) ระยะเพิ่มตามเลเวล" },
  { id: "speed", level: 8, name: "วิ่งเร็ว", icon: "textures/items/sugar", desc: "ได้ Speed I (Lv.60 ขึ้นไปเป็น II)" },
  { id: "tree_feller", level: 10, name: "ตัดต้นไม้ทั้งต้น", icon: "textures/items/iron_axe", desc: "ใช้ขวานตัดไม้ 1 ท่อน ต้นไม้ทั้งต้นพัง ของเข้าหาตัว" },
  { id: "jump", level: 12, name: "กระโดดสูง", icon: "textures/items/rabbit_foot", desc: "ได้ Jump Boost II" },
  { id: "vein_miner", level: 15, name: "ขุดแร่ทั้งสาย", icon: "textures/items/iron_pickaxe", desc: "ใช้อีเตอร์ขุดแร่ 1 ก้อน แร่ชนิดเดียวกันที่ติดกันแตกหมด" },
  { id: "water_breathing", level: 18, name: "หายใจใต้น้ำ", icon: "textures/items/fish_pufferfish_raw", desc: "ไม่จมน้ำตาย" },
  { id: "fire_resist", level: 20, name: "กันไฟ", icon: "textures/items/blaze_powder", desc: "ไม่รับดาเมจจากไฟและลาวา" },
  { id: "satiety", level: 22, name: "อิ่มทิพย์", icon: "textures/items/bread", desc: "ได้ความอิ่มเพิ่มทุก 20 วินาที หิวช้าลงมาก" },
  { id: "soft_landing", level: 25, name: "ร่อนลงนุ่มนวล", icon: "textures/items/feather", desc: "ตกจากที่สูงจะร่อนลงช้า ๆ ไม่ตกตาย" },
  { id: "auto_smelt", level: 28, name: "หลอมแร่อัตโนมัติ", icon: "textures/items/iron_ingot", desc: "แร่เหล็ก/ทอง/ทองแดงดรอปเป็นแท่ง, เศษโบราณเป็นเศษเนเธอไรต์" },
  { id: "flight", level: 30, name: "บินได้", icon: "textures/items/elytra", desc: "บินในโหมดเอาชีวิตรอด (ดูวิธีบินในหน้าวิธีเล่น)" },
  { id: "haste", level: 35, name: "ขุดไว", icon: "textures/items/gold_pickaxe", desc: "ได้ Haste I (Lv.70 ขึ้นไปเป็น II)" },
  { id: "regen", level: 40, name: "ฟื้นฟูพลังชีวิต", icon: "textures/items/ghast_tear", desc: "ได้ Regeneration I ตลอดเวลา" },
  { id: "growth", level: 45, name: "ออร่าเร่งการเติบโต", icon: "textures/items/dye_powder_white", desc: "พืชรอบตัวรัศมี 5 บล็อกโตเร็วขึ้น" },
  { id: "invisible", level: 50, name: "ล่องหน", icon: "textures/items/potion_bottle_invisibility", desc: "ตัวล่องหน (เกราะที่ใส่ยังมองเห็น)" },
  { id: "strength", level: 60, name: "พลังยักษ์", icon: "textures/items/blaze_rod", desc: "ได้ Strength I (Lv.85 ขึ้นไปเป็น II)" },
  { id: "thunder", level: 70, name: "หมัดสายฟ้า", icon: "textures/items/nether_star", desc: "ตีระยะประชิด 10% เรียกสายฟ้าลงศัตรู" },
  { id: "guardian", level: 80, name: "ออร่าพิทักษ์", icon: "textures/items/totem", desc: "ได้ Resistance I ตลอดเวลา" },
  { id: "god", level: 100, name: "ร่างเทพ", icon: "textures/items/nether_star", desc: "เอฟเฟกต์ของทุกสกิลที่เปิดอยู่ +1 ระดับ, ดาเมจ +20%" },
];

/** @type {Record<string, typeof SKILLS[number]>} */
export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

// ---------------------------------------------------------------------------
// XP ที่ได้จากกิจกรรมต่าง ๆ
// ---------------------------------------------------------------------------

/** XP ตัวละครจากการขุดแร่ (ต่อก้อน) */
export const ORE_XP = {
  "minecraft:coal_ore": 4,
  "minecraft:deepslate_coal_ore": 5,
  "minecraft:copper_ore": 4,
  "minecraft:deepslate_copper_ore": 5,
  "minecraft:iron_ore": 7,
  "minecraft:deepslate_iron_ore": 8,
  "minecraft:gold_ore": 9,
  "minecraft:deepslate_gold_ore": 10,
  "minecraft:redstone_ore": 6,
  "minecraft:lit_redstone_ore": 6,
  "minecraft:deepslate_redstone_ore": 7,
  "minecraft:lit_deepslate_redstone_ore": 7,
  "minecraft:lapis_ore": 8,
  "minecraft:deepslate_lapis_ore": 9,
  "minecraft:diamond_ore": 25,
  "minecraft:deepslate_diamond_ore": 28,
  "minecraft:emerald_ore": 30,
  "minecraft:deepslate_emerald_ore": 33,
  "minecraft:quartz_ore": 5,
  "minecraft:nether_gold_ore": 4,
  "minecraft:ancient_debris": 50,
};

/** XP ปกติของเกม (ลูกแก้วเขียว) ที่ได้เพิ่มจากอีเตอร์ Lv.40 */
export const ORE_VANILLA_XP = {
  coal: 1, copper: 1, iron: 1, gold: 1, redstone: 3, lapis: 4,
  diamond: 5, emerald: 5, quartz: 3, nether_gold: 1, ancient_debris: 2,
};

/** ไอเท็มที่ถือว่าเป็น "ของจากแร่" (ใช้คิดดรอปคู่ / หลอม) */
export const ORE_DROPS = new Set([
  "minecraft:coal", "minecraft:raw_copper", "minecraft:raw_iron", "minecraft:raw_gold",
  "minecraft:redstone", "minecraft:lapis_lazuli", "minecraft:diamond", "minecraft:emerald",
  "minecraft:quartz", "minecraft:gold_nugget", "minecraft:ancient_debris",
  "minecraft:copper_ingot", "minecraft:iron_ingot", "minecraft:gold_ingot", "minecraft:netherite_scrap",
]);

/** ตารางหลอมอัตโนมัติ */
export const SMELT = {
  "minecraft:raw_iron": "minecraft:iron_ingot",
  "minecraft:raw_gold": "minecraft:gold_ingot",
  "minecraft:raw_copper": "minecraft:copper_ingot",
  "minecraft:ancient_debris": "minecraft:netherite_scrap",
};

/** XP ตัวละครจากการฆ่ามอนสเตอร์ */
export const MOB_XP = {
  "minecraft:zombie": 15, "minecraft:husk": 16, "minecraft:drowned": 16, "minecraft:zombie_villager_v2": 15,
  "minecraft:skeleton": 15, "minecraft:stray": 16, "minecraft:bogged": 16,
  "minecraft:creeper": 20, "minecraft:spider": 12, "minecraft:cave_spider": 14,
  "minecraft:enderman": 30, "minecraft:witch": 30, "minecraft:slime": 5, "minecraft:magma_cube": 6,
  "minecraft:blaze": 25, "minecraft:ghast": 35, "minecraft:wither_skeleton": 35,
  "minecraft:piglin": 15, "minecraft:zombie_pigman": 15, "minecraft:piglin_brute": 60,
  "minecraft:hoglin": 25, "minecraft:zoglin": 30, "minecraft:guardian": 25, "minecraft:elder_guardian": 250,
  "minecraft:phantom": 15, "minecraft:pillager": 20, "minecraft:vindicator": 30, "minecraft:evocation_illager": 70,
  "minecraft:ravager": 80, "minecraft:vex": 8, "minecraft:silverfish": 3, "minecraft:endermite": 5,
  "minecraft:shulker": 25, "minecraft:breeze": 40, "minecraft:creaking": 20,
  "minecraft:warden": 500, "minecraft:wither": 1500, "minecraft:ender_dragon": 3000,
  "minecraft:player": 50,
};
export const DEFAULT_MONSTER_XP = 12;
export const DEFAULT_ANIMAL_XP = 3;

/** มอนที่ "ประหาร" ใช้ไม่ได้ */
export const BOSSES = new Set([
  "minecraft:wither", "minecraft:ender_dragon", "minecraft:warden", "minecraft:elder_guardian", "minecraft:player",
]);

/** พืช: สถานะการโต, ค่าที่ถือว่าโตเต็มที่, ของที่ใช้ปลูกใหม่, ผลผลิต */
export const CROPS = {
  "minecraft:wheat": { state: "growth", max: 7, seed: "minecraft:wheat_seeds", produce: "minecraft:wheat" },
  "minecraft:carrots": { state: "growth", max: 7, seed: "minecraft:carrot", produce: "minecraft:carrot" },
  "minecraft:potatoes": { state: "growth", max: 7, seed: "minecraft:potato", produce: "minecraft:potato" },
  "minecraft:beetroot": { state: "growth", max: 7, seed: "minecraft:beetroot_seeds", produce: "minecraft:beetroot" },
  "minecraft:nether_wart": { state: "age", max: 3, seed: "minecraft:nether_wart", produce: "minecraft:nether_wart" },
};
/** บล็อกพืชที่เก็บได้เลย (ไม่มีสถานะการโต) */
export const WHOLE_CROPS = {
  "minecraft:melon_block": "minecraft:melon_slice",
  "minecraft:pumpkin": "minecraft:pumpkin",
};

/** บล็อกที่พลั่วขุด (ใช้กับขุด 3x3 และล่าสมบัติ) */
export const SHOVEL_BLOCKS = new Set([
  "minecraft:dirt", "minecraft:grass_block", "minecraft:sand", "minecraft:red_sand", "minecraft:gravel",
  "minecraft:clay", "minecraft:snow", "minecraft:snow_layer", "minecraft:soul_sand", "minecraft:soul_soil",
  "minecraft:mud", "minecraft:podzol", "minecraft:mycelium", "minecraft:coarse_dirt", "minecraft:rooted_dirt",
  "minecraft:farmland", "minecraft:grass_path", "minecraft:dirt_path", "minecraft:suspicious_sand",
  "minecraft:suspicious_gravel", "minecraft:muddy_mangrove_roots",
]);

export const TREASURE_BASIC = [
  "minecraft:flint", "minecraft:clay_ball", "minecraft:iron_nugget", "minecraft:gold_nugget", "minecraft:bone",
];
export const TREASURE_RARE = [
  "minecraft:iron_ingot", "minecraft:gold_ingot", "minecraft:emerald", "minecraft:diamond",
  "minecraft:name_tag", "minecraft:saddle", "minecraft:golden_apple",
];

// ---------------------------------------------------------------------------
// ขีดจำกัดสกิล
// ---------------------------------------------------------------------------

export const magnetRange = (level) => Math.min(12, 4 + Math.floor(level / 10));
export const veinLimit = (level) => Math.min(128, 16 + level);
export const treeLimit = (level) => Math.min(400, 64 + level * 4);
export const BLOCKS_PER_TICK = 8; // ทยอยทุบทีละกี่บล็อกต่อ tick (กันแลค)

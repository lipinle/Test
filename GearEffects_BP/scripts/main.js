// Gear Effects - สวมเกราะ / ถือไอเท็ม แล้วได้เอฟเฟกต์ที่เกี่ยวข้อง
//
// เกราะ: นับจำนวนชิ้นของวัสดุเดียวกัน ยิ่งใส่ครบยิ่งได้เอฟเฟกต์มาก
// มือ:   ดูไอเท็มในมือหลักและมือรอง ถ้าเป็นเครื่องมือระดับสูงจะได้เอฟเฟกต์แรงขึ้น
//
// สคริปต์จะลบเฉพาะเอฟเฟกต์ที่ตัวเองใส่ให้ ไม่ไปลบเอฟเฟกต์จากยา/บีคอน (ถ้าแรงกว่าหรือนานกว่า)

import { world, system, EquipmentSlot } from "@minecraft/server";

// ---------- ตั้งค่า ----------

// amp = ระดับเอฟเฟกต์ เริ่มที่ 0 (0 = I, 1 = II, ...)

/** เซ็ตเกราะ: วัสดุ -> รายการ { pieces: ใส่กี่ชิ้นขึ้นไป, effect, amp } */
const ARMOR_SETS = {
  leather: {
    name: "หนัง",
    bonuses: [
      { pieces: 2, effect: "speed", amp: 0 },
      { pieces: 4, effect: "jump_boost", amp: 0 },
    ],
  },
  chainmail: {
    name: "โซ่",
    bonuses: [
      { pieces: 2, effect: "speed", amp: 0 },
      { pieces: 4, effect: "haste", amp: 0 },
    ],
  },
  copper: {
    name: "ทองแดง",
    bonuses: [
      { pieces: 2, effect: "haste", amp: 0 },
      { pieces: 4, effect: "resistance", amp: 0 },
    ],
  },
  golden: {
    name: "ทอง",
    bonuses: [
      { pieces: 2, effect: "haste", amp: 0 },
      { pieces: 4, effect: "regeneration", amp: 0 },
    ],
  },
  iron: {
    name: "เหล็ก",
    bonuses: [
      { pieces: 2, effect: "resistance", amp: 0 },
      { pieces: 4, effect: "strength", amp: 0 },
    ],
  },
  diamond: {
    name: "เพชร",
    bonuses: [
      { pieces: 2, effect: "resistance", amp: 0 },
      { pieces: 4, effect: "strength", amp: 0 },
      { pieces: 4, effect: "regeneration", amp: 0 },
    ],
  },
  netherite: {
    name: "เนเธอไรต์",
    bonuses: [
      { pieces: 2, effect: "resistance", amp: 0 },
      { pieces: 2, effect: "fire_resistance", amp: 0 },
      { pieces: 4, effect: "resistance", amp: 1 },
      { pieces: 4, effect: "strength", amp: 1 },
      { pieces: 4, effect: "regeneration", amp: 0 },
    ],
  },
  turtle: {
    name: "กระดองเต่า",
    bonuses: [
      { pieces: 1, effect: "water_breathing", amp: 0 },
      { pieces: 1, effect: "night_vision", amp: 0 },
    ],
  },
};

/** อาวุธ/เครื่องมือ: ดูจากท้ายชื่อไอเท็ม เช่น iron_sword -> _sword */
const TOOL_EFFECTS = {
  _sword: [{ effect: "strength", amp: 0 }],
  _axe: [{ effect: "strength", amp: 0 }],
  _pickaxe: [{ effect: "haste", amp: 0 }],
  _shovel: [{ effect: "haste", amp: 0 }],
  _hoe: [{ effect: "haste", amp: 0 }],
};

/** ระดับวัสดุของเครื่องมือ -> บวกระดับเอฟเฟกต์เพิ่ม */
const TOOL_TIER_BONUS = {
  wooden: 0,
  stone: 0,
  copper: 0,
  golden: 0,
  iron: 0,
  diamond: 1,
  netherite: 1,
};

/** ไอเท็มเฉพาะชนิด */
const ITEM_EFFECTS = {
  "minecraft:bow": [{ effect: "speed", amp: 0 }],
  "minecraft:crossbow": [{ effect: "speed", amp: 0 }],
  "minecraft:trident": [{ effect: "conduit_power", amp: 0 }],
  "minecraft:mace": [{ effect: "jump_boost", amp: 1 }],
  "minecraft:shield": [{ effect: "resistance", amp: 0 }],
  "minecraft:fishing_rod": [{ effect: "water_breathing", amp: 0 }],
  "minecraft:torch": [{ effect: "night_vision", amp: 0 }],
  "minecraft:soul_torch": [{ effect: "night_vision", amp: 0 }],
  "minecraft:lantern": [{ effect: "night_vision", amp: 0 }],
  "minecraft:soul_lantern": [{ effect: "night_vision", amp: 0 }],
  "minecraft:spyglass": [{ effect: "night_vision", amp: 0 }],
  "minecraft:feather": [{ effect: "slow_falling", amp: 0 }],
  "minecraft:sugar": [{ effect: "speed", amp: 0 }],
  "minecraft:rabbit_foot": [{ effect: "jump_boost", amp: 0 }],
  "minecraft:blaze_rod": [{ effect: "fire_resistance", amp: 0 }],
  "minecraft:magma_cream": [{ effect: "fire_resistance", amp: 0 }],
  "minecraft:nautilus_shell": [{ effect: "water_breathing", amp: 0 }],
  "minecraft:heart_of_the_sea": [{ effect: "conduit_power", amp: 0 }],
  "minecraft:totem_of_undying": [{ effect: "regeneration", amp: 0 }],
  "minecraft:glistering_melon_slice": [{ effect: "regeneration", amp: 0 }],
  "minecraft:ender_eye": [{ effect: "night_vision", amp: 0 }],
};

/** ชื่อเอฟเฟกต์ภาษาไทย (ใช้แสดงข้อความ) */
const EFFECT_NAMES = {
  speed: "ความเร็ว",
  haste: "ขุดเร็ว",
  strength: "พลังโจมตี",
  jump_boost: "กระโดดสูง",
  regeneration: "ฟื้นฟูเลือด",
  resistance: "ต้านทาน",
  fire_resistance: "กันไฟ",
  water_breathing: "หายใจใต้น้ำ",
  night_vision: "มองในที่มืด",
  slow_falling: "ตกช้า",
  conduit_power: "พลังคอนดูอิต",
};

const CHECK_INTERVAL = 20; // ตรวจทุก 1 วินาที
const EFFECT_DURATION = 400; // ใส่เอฟเฟกต์ครั้งละ 20 วินาที (มองในที่มืดจะไม่กะพริบ)
const REFRESH_BELOW = 300; // เหลือน้อยกว่านี้ค่อยต่อเวลา (ไม่รีเซ็ตจังหวะฟื้นฟูเลือด)
const SHOW_MESSAGES = true; // แสดงข้อความเมื่อเอฟเฟกต์เปลี่ยน

// ---------- ฟังก์ชันช่วย ----------

const ARMOR_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];
const ARMOR_SUFFIXES = ["_helmet", "_chestplate", "_leggings", "_boots"];
const ROMAN = ["I", "II", "III", "IV", "V"];

/** player.id -> Map<effect, amp> ที่สคริปต์ใส่ให้อยู่ */
const appliedEffects = new Map();
/** player.id -> ข้อความล่าสุดที่แสดง */
const lastSummary = new Map();

/** "minecraft:iron_helmet" -> "iron" */
function getArmorMaterial(typeId) {
  const name = typeId.replace("minecraft:", "");
  const suffix = ARMOR_SUFFIXES.find((s) => name.endsWith(s));
  if (!suffix) return undefined;
  return name.slice(0, -suffix.length);
}

function addWanted(wanted, effect, amp) {
  if ((wanted.get(effect) ?? -1) < amp) wanted.set(effect, amp);
}

function collectArmorEffects(equipment, wanted) {
  const counts = {};
  for (const slot of ARMOR_SLOTS) {
    const item = equipment.getEquipment(slot);
    if (!item) continue;
    const material = getArmorMaterial(item.typeId);
    if (material) counts[material] = (counts[material] ?? 0) + 1;
  }
  for (const [material, count] of Object.entries(counts)) {
    for (const bonus of ARMOR_SETS[material]?.bonuses ?? []) {
      if (count >= bonus.pieces) addWanted(wanted, bonus.effect, bonus.amp);
    }
  }
}

function collectItemEffects(item, wanted) {
  if (!item) return;
  const typeId = item.typeId;
  for (const e of ITEM_EFFECTS[typeId] ?? []) addWanted(wanted, e.effect, e.amp);

  const name = typeId.replace("minecraft:", "");
  for (const [suffix, effects] of Object.entries(TOOL_EFFECTS)) {
    if (!name.endsWith(suffix)) continue;
    const tier = name.slice(0, -suffix.length);
    const bonus = TOOL_TIER_BONUS[tier] ?? 0;
    for (const e of effects) addWanted(wanted, e.effect, e.amp + bonus);
  }
}

/** คำนวณเอฟเฟกต์ที่ผู้เล่นควรได้ตอนนี้ */
function getWantedEffects(player) {
  const wanted = new Map();
  const equipment = player.getComponent("minecraft:equippable");
  if (!equipment) return wanted;
  collectArmorEffects(equipment, wanted);
  collectItemEffects(equipment.getEquipment(EquipmentSlot.Mainhand), wanted);
  collectItemEffects(equipment.getEquipment(EquipmentSlot.Offhand), wanted);
  return wanted;
}

function applyEffect(player, effect, amp) {
  const current = player.getEffect(effect);
  if (current) {
    // มีเอฟเฟกต์ที่แรงกว่า หรือยังเหลือเวลาพอ (เช่น จากยา) -> ไม่ต้องทำอะไร
    if (current.amplifier > amp) return;
    if (current.amplifier === amp && current.duration >= REFRESH_BELOW) return;
  }
  player.addEffect(effect, EFFECT_DURATION, { amplifier: amp, showParticles: false });
}

/** ลบเอฟเฟกต์ที่สคริปต์ใส่ให้ แต่ไม่ลบเอฟเฟกต์จากแหล่งอื่น */
function removeOurEffect(player, effect, amp) {
  const current = player.getEffect(effect);
  if (current && current.amplifier === amp && current.duration <= EFFECT_DURATION) {
    player.removeEffect(effect);
  }
}

function describe(wanted) {
  return [...wanted]
    .map(([effect, amp]) => `${EFFECT_NAMES[effect] ?? effect} ${ROMAN[amp] ?? amp + 1}`)
    .join("§7, §b");
}

function updatePlayer(player) {
  const wanted = getWantedEffects(player);
  const previous = appliedEffects.get(player.id) ?? new Map();

  for (const [effect, amp] of previous) {
    if (wanted.get(effect) !== amp) removeOurEffect(player, effect, amp);
  }
  for (const [effect, amp] of wanted) applyEffect(player, effect, amp);
  appliedEffects.set(player.id, wanted);

  if (SHOW_MESSAGES) {
    const summary = describe(wanted);
    if (summary !== (lastSummary.get(player.id) ?? "")) {
      lastSummary.set(player.id, summary);
      player.onScreenDisplay.setActionBar(summary ? `§e✦ §b${summary}` : "§7✦ ไม่มีเอฟเฟกต์จากอุปกรณ์");
    }
  }
}

// ---------- อีเวนต์ ----------

world.afterEvents.playerLeave.subscribe((event) => {
  appliedEffects.delete(event.playerId);
  lastSummary.delete(event.playerId);
});

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      updatePlayer(player);
    } catch {
      // ผู้เล่นอาจเพิ่งออกจากเกม / กำลังเกิดใหม่
    }
  }
}, CHECK_INTERVAL);

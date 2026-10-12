// แต่งตัวมอนตอนเกิด: เกราะ อาวุธ เอนชานต์ เอฟเฟกต์ — ตามระดับปัจจุบัน

import { EnchantmentType, EquipmentSlot, ItemStack } from "@minecraft/server";
import { ELITE_CHANCE, MAX_GEAR_WEAR, MOB_KIND, TIERS } from "./config.js";
import { chance, pick, randInt } from "./util.js";

/** ป้ายบนไอเท็มที่สคริปต์ใส่ให้ — ใช้แยกของตอนมอนตาย */
export const GEAR_LORE = "§8Smart Mobs";
/** แท็กบนมอนที่แต่งตัวแล้ว */
export const MOB_TAG = "smartmobs";

/** ไอเท็มทุกชนิดที่สคริปต์อาจใส่ให้ */
export const GEAR_IDS = new Set(["minecraft:bow", "minecraft:crossbow", "minecraft:trident"]);
const ARMOR_PIECES = [
  [EquipmentSlot.Head, "helmet", "slot.armor.head"],
  [EquipmentSlot.Chest, "chestplate", "slot.armor.chest"],
  [EquipmentSlot.Legs, "leggings", "slot.armor.legs"],
  [EquipmentSlot.Feet, "boots", "slot.armor.feet"],
];
for (const m of ["leather", "chainmail", "golden", "iron", "diamond", "netherite"]) {
  for (const [, piece] of ARMOR_PIECES) GEAR_IDS.add(`minecraft:${m}_${piece}`);
}
for (const t of TIERS) for (const w of t.melee) GEAR_IDS.add(`minecraft:${w}`);
for (const m of ["iron", "diamond", "netherite"]) GEAR_IDS.add(`minecraft:${m}_axe`);

/** true เมื่อเกมไม่ยอมให้สคริปต์ใส่ของให้มอนตรง ๆ แล้วต้องใช้คำสั่ง /replaceitem แทน */
export let usingCommandFallback = false;

// ---------------------------------------------------------------------------
// สร้างไอเท็ม
// ---------------------------------------------------------------------------

function enchantsFor(id, maxLevel) {
  const lv = (cap) => randInt(1, Math.min(cap, maxLevel));
  const list = [];
  if (/_(helmet|chestplate|leggings|boots)$/.test(id)) {
    list.push(["protection", lv(4)]);
    if (id.endsWith("_chestplate") && maxLevel >= 5 && chance(0.3)) list.push(["thorns", lv(3)]);
    if (id.endsWith("_boots") && maxLevel >= 3 && chance(0.3)) list.push(["feather_falling", lv(4)]);
  } else if (id.endsWith("_sword") || id.endsWith("_axe")) {
    list.push(["sharpness", lv(5)]);
    if (maxLevel >= 3 && chance(0.35)) list.push(["fire_aspect", Math.min(2, maxLevel - 2)]);
    if (maxLevel >= 2 && chance(0.3)) list.push(["knockback", Math.min(2, maxLevel - 1)]);
  } else if (id === "bow") {
    list.push(["power", lv(5)]);
    if (maxLevel >= 3 && chance(0.4)) list.push(["punch", Math.min(2, maxLevel - 2)]);
    if (maxLevel >= 4 && chance(0.35)) list.push(["flame", 1]);
  } else if (id === "crossbow") {
    list.push(["quick_charge", lv(3)]);
    if (maxLevel >= 3 && chance(0.5)) list.push(chance(0.5) ? ["multishot", 1] : ["piercing", lv(4)]);
  } else if (id === "trident") {
    list.push(["impaling", lv(5)]);
  }
  return list;
}

/** @param {string} id ชื่อไอเท็มไม่มี minecraft: */
function makeItem(id, tier) {
  const item = new ItemStack(`minecraft:${id}`);
  try {
    item.setLore([GEAR_LORE]);
  } catch {
    // ไม่เป็นไร
  }
  if (tier.enchant > 0 && chance(tier.enchantChance)) {
    const ench = item.getComponent("minecraft:enchantable");
    if (ench) {
      for (const [type, level] of enchantsFor(id, tier.enchant)) {
        try {
          const e = { type: new EnchantmentType(type), level };
          if (ench.canAddEnchantment(e)) ench.addEnchantment(e);
        } catch {
          // เอนชานต์ใช้ไม่ได้กับไอเท็มนี้
        }
      }
    }
  }
  const dur = item.getComponent("minecraft:durability");
  if (dur && MAX_GEAR_WEAR > 0) {
    try {
      dur.damage = Math.floor(Math.random() * MAX_GEAR_WEAR * dur.maxDurability);
    } catch {
      // ไม่เป็นไร
    }
  }
  return item;
}

/** ใส่ไอเท็มให้มอน — ลองใช้ Equippable ก่อน ถ้าไม่ได้ใช้คำสั่ง /replaceitem */
function equip(entity, slot, cmdSlot, id, tier) {
  try {
    const eq = entity.getComponent("minecraft:equippable");
    if (eq) {
      const item = makeItem(id, tier);
      eq.setEquipment(slot, item);
      if (eq.getEquipment(slot)?.typeId === item.typeId) return;
    }
  } catch {
    // มอนตัวนี้ไม่รองรับ
  }
  usingCommandFallback = true;
  try {
    entity.runCommand(`replaceitem entity @s ${cmdSlot} 0 ${id}`);
  } catch {
    // ไม่เป็นไร
  }
}

// ---------------------------------------------------------------------------
// แต่งตัว
// ---------------------------------------------------------------------------

function pickWeapon(kind, tier) {
  switch (kind) {
    case "melee":
      return chance(tier.weaponChance) ? pick(tier.melee) : undefined;
    case "axe": {
      // Vindicator ถือขวานเหล็กอยู่แล้ว เปลี่ยนเฉพาะเมื่อได้ของดีกว่า
      if (!chance(tier.weaponChance)) return undefined;
      const mat = pick(tier.melee).split("_")[0];
      if (mat === "diamond" || mat === "netherite") return `${mat}_axe`;
      return tier.enchant > 0 ? "iron_axe" : undefined;
    }
    case "drowned":
      if (chance(tier.trident)) return "trident";
      return chance(tier.weaponChance) ? pick(tier.melee) : undefined;
    case "bow":
      // ถือธนูอยู่แล้ว เปลี่ยนเป็นธนูเอนชานต์เมื่อถึงระดับที่มีเอนชานต์
      return tier.enchant > 0 && chance(tier.weaponChance) ? "bow" : undefined;
    case "crossbow":
      return tier.enchant > 0 && chance(tier.weaponChance) ? "crossbow" : undefined;
    default:
      return undefined;
  }
}

function applyEffects(entity, tier) {
  let boosted = false;
  for (const fx of tier.effects) {
    if (!chance(fx.chance)) continue;
    try {
      entity.addEffect(fx.id, 20000000, { amplifier: fx.amp, showParticles: false });
      if (fx.id === "health_boost") boosted = true;
    } catch {
      // ไม่เป็นไร
    }
  }
  if (boosted) {
    try {
      entity.getComponent("minecraft:health")?.resetToMaxValue();
    } catch {
      // ไม่เป็นไร
    }
  }
}

/** แต่งตัวมอนตามระดับ — เรียกครั้งเดียวต่อมอนหนึ่งตัว */
export function outfit(entity, tierIndex) {
  const kind = MOB_KIND[entity.typeId];
  if (!kind) return;
  entity.addTag(MOB_TAG);
  if (tierIndex <= 0) return;

  // หัวหน้า: ได้ของระดับถัดไป
  if (tierIndex < TIERS.length - 1 && chance(ELITE_CHANCE)) tierIndex++;
  const tier = TIERS[tierIndex];

  if (kind !== "buff") {
    for (const [slot, piece, cmdSlot] of ARMOR_PIECES) {
      if (chance(tier.armorChance) && tier.armor.length) {
        equip(entity, slot, cmdSlot, `${pick(tier.armor)}_${piece}`, tier);
      }
    }
    const weapon = pickWeapon(kind, tier);
    if (weapon) equip(entity, EquipmentSlot.Mainhand, "slot.weapon.mainhand", weapon, tier);
  }

  if (entity.typeId === "minecraft:creeper" && chance(tier.ai.charged)) {
    try {
      entity.triggerEvent("minecraft:become_charged");
    } catch {
      // ไม่เป็นไร
    }
  }

  applyEffects(entity, tier);
}

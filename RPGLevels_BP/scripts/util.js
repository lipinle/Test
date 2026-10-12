// ฟังก์ชันช่วยที่ใช้หลายไฟล์

import { EquipmentSlot, GameMode, ItemStack, system } from "@minecraft/server";

export const chance = (p) => Math.random() < p;
export const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

/** @param {import("@minecraft/server").Vector3} v */
export const key = (v) => `${v.x},${v.y},${v.z}`;
export const center = (v) => ({ x: v.x + 0.5, y: v.y + 0.5, z: v.z + 0.5 });

export function isCreative(player) {
  const mode = player.getGameMode();
  return mode === GameMode.Creative || mode === GameMode.Spectator;
}

/** ประเภทอุปกรณ์ของไอเท็ม ตรงกับคีย์ใน PROFS */
export function toolCategory(item) {
  if (!item) return undefined;
  const id = item.typeId;
  const tag = (t) => {
    try {
      return item.hasTag(t);
    } catch {
      return false;
    }
  };
  if (tag("minecraft:is_pickaxe") || id.endsWith("_pickaxe")) return "pickaxe";
  if (tag("minecraft:is_axe") || id.endsWith("_axe")) return "axe";
  if (tag("minecraft:is_shovel") || id.endsWith("_shovel")) return "shovel";
  if (tag("minecraft:is_hoe") || id.endsWith("_hoe")) return "hoe";
  if (tag("minecraft:is_sword") || id.endsWith("_sword")) return "sword";
  if (id === "minecraft:bow" || id === "minecraft:crossbow") return "bow";
  if (id === "minecraft:trident") return "trident";
  return undefined;
}

export function getEquip(entity) {
  return entity.getComponent("minecraft:equippable");
}

export function mainhand(player) {
  return getEquip(player)?.getEquipment(EquipmentSlot.Mainhand);
}

export function armorCount(player) {
  const eq = getEquip(player);
  if (!eq) return 0;
  let n = 0;
  for (const slot of [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet]) {
    const it = eq.getEquipment(slot);
    if (it && it.typeId !== "minecraft:elytra" && it.typeId !== "minecraft:carved_pumpkin") n++;
  }
  return n;
}

export function enchantLevel(item, id) {
  try {
    return item?.getComponent("minecraft:enchantable")?.getEnchantment(id)?.level ?? 0;
  } catch {
    return 0;
  }
}

/**
 * ทำให้เครื่องมือในมือสึก `amount` ครั้ง (คิด Unbreaking)
 * คืน false ถ้าเครื่องมือจะพัง — สกิลจะหยุดทำงานเพื่อรักษาเครื่องมือไว้
 */
export function damageTool(player, amount) {
  if (isCreative(player)) return true;
  const eq = getEquip(player);
  const item = eq?.getEquipment(EquipmentSlot.Mainhand);
  if (!eq || !item) return false;
  const dur = item.getComponent("minecraft:durability");
  if (!dur) return true;
  const unbreaking = enchantLevel(item, "unbreaking");
  let applied = 0;
  for (let i = 0; i < amount; i++) if (chance(1 / (unbreaking + 1))) applied++;
  if (dur.damage + applied >= dur.maxDurability - 1) return false;
  if (applied > 0) {
    dur.damage += applied;
    eq.setEquipment(EquipmentSlot.Mainhand, item);
  }
  return true;
}

/** ทุบบล็อกให้ดรอปของเหมือนผู้เล่นทุบ (Silk Touch = ได้ตัวบล็อก) */
export function destroyBlock(dimension, pos, silk = false) {
  const block = dimension.getBlock(pos);
  if (!block || block.isAir) return false;
  if (silk) {
    const id = block.typeId.replace("lit_", "");
    block.setType("minecraft:air");
    try {
      dimension.spawnItem(new ItemStack(id, 1), center(pos));
    } catch {
      // บล็อกนี้ไม่มีไอเท็ม
    }
    return true;
  }
  dimension.runCommand(`setblock ${pos.x} ${pos.y} ${pos.z} air destroy`);
  return true;
}

/** ไอเท็มที่ตกอยู่รอบจุด */
export function itemsNear(dimension, location, radius) {
  return dimension.getEntities({ type: "minecraft:item", location, maxDistance: radius });
}

export function stackOf(itemEntity) {
  try {
    return itemEntity.getComponent("minecraft:item")?.itemStack;
  } catch {
    return undefined;
  }
}

/** เอาไอเท็ม 1 ชิ้นออกจากกระเป๋า คืน true ถ้าสำเร็จ */
export function takeFromInventory(player, typeId) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return false;
  for (let i = 0; i < inv.size; i++) {
    const it = inv.getItem(i);
    if (it?.typeId !== typeId) continue;
    if (it.amount > 1) {
      it.amount--;
      inv.setItem(i, it);
    } else {
      inv.setItem(i, undefined);
    }
    return true;
  }
  return false;
}

/** ทำงานทีละชุดต่อ tick เพื่อไม่ให้เกมกระตุก */
export function runBatched(items, perTick, fn, onDone) {
  let i = 0;
  const step = () => {
    const end = Math.min(items.length, i + perTick);
    for (; i < end; i++) {
      if (fn(items[i], i) === false) {
        i = items.length;
        break;
      }
    }
    if (i < items.length) system.runTimeout(step, 1);
    else onDone?.();
  };
  step();
}


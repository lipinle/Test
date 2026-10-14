// Mining Hammers — ค้อนขุดหินเป็นพื้นที่ 3x3 (เนเทอไรท์ 5x5)
// บล็อกตรงกลางเกมขุดเองตามปกติ สคริปต์นี้ขุดบล็อกรอบ ๆ ให้ โดยใช้ loot table ของเกม
// จึงได้ของตามจริงและคิดเอนชานท์ของค้อน (Fortune, Silk Touch, Unbreaking) ครบ

import { Direction, EquipmentSlot, GameMode, world } from "@minecraft/server";

// ---------------------------------------------------------------------------
// ตั้งค่า
// ---------------------------------------------------------------------------

/** ค้อน -> รัศมี (1 = 3x3, 2 = 5x5) */
const HAMMERS = {
  "hammers:wooden_hammer": 1,
  "hammers:stone_hammer": 1,
  "hammers:iron_hammer": 1,
  "hammers:golden_hammer": 1,
  "hammers:diamond_hammer": 1,
  "hammers:netherite_hammer": 2,
};

/** ย่อตัวค้างไว้ = ขุดทีละบล็อกเหมือนพิกแอ็กซ์ */
const SNEAK_FOR_SINGLE = true;
/** ความทนทานที่ลดต่อบล็อกรอบ ๆ ที่ขุดได้ (บล็อกตรงกลางลด 1 ตามปกติ) */
const WEAR_PER_EXTRA_BLOCK = 1;
/** รวมของที่ดรอปไว้ที่บล็อกตรงกลาง เก็บง่ายกว่าบนมือถือ */
const DROPS_TO_CENTER = true;

/** ไม่ขุดเด็ดขาด */
const NEVER_BREAK = new Set([
  "minecraft:bedrock",
  "minecraft:barrier",
  "minecraft:command_block",
  "minecraft:chain_command_block",
  "minecraft:repeating_command_block",
  "minecraft:structure_block",
  "minecraft:structure_void",
  "minecraft:jigsaw",
  "minecraft:end_portal_frame",
  "minecraft:end_gateway",
  "minecraft:reinforced_deepslate",
  "minecraft:light_block",
  "minecraft:allow",
  "minecraft:deny",
  "minecraft:border_block",
  "minecraft:mob_spawner",
  "minecraft:trial_spawner",
  "minecraft:vault",
  "minecraft:budding_amethyst",
]);

/** บล็อกแข็งมาก จะโดนขุดรอบ ๆ ก็ต่อเมื่อบล็อกตรงกลางเป็นบล็อกแข็งเหมือนกัน (กันขุดหินแล้วออบซิเดียนหายไปด้วย) */
const TOUGH = new Set([
  "minecraft:obsidian",
  "minecraft:crying_obsidian",
  "minecraft:ancient_debris",
  "minecraft:netherite_block",
  "minecraft:respawn_anchor",
  "minecraft:ender_chest",
  "minecraft:enchanting_table",
]);

/** แร่ -> [XP ต่ำสุด, สูงสุด] (ชื่อแบบตัด deepslate_ / lit_ ออกแล้ว) */
const ORE_XP = {
  "minecraft:coal_ore": [0, 2],
  "minecraft:diamond_ore": [3, 7],
  "minecraft:emerald_ore": [3, 7],
  "minecraft:lapis_ore": [2, 5],
  "minecraft:quartz_ore": [2, 5],
  "minecraft:redstone_ore": [1, 5],
  "minecraft:nether_gold_ore": [0, 1],
};

// ---------------------------------------------------------------------------

/** player.id -> { face, x, y, z } หน้าบล็อกที่ตีล่าสุด */
const lastHit = new Map();

world.afterEvents.entityHitBlock.subscribe((ev) => {
  const p = ev.damagingEntity;
  if (p.typeId !== "minecraft:player") return;
  const { x, y, z } = ev.hitBlock.location;
  lastHit.set(p.id, { face: ev.blockFace, x, y, z });
});

world.afterEvents.playerLeave.subscribe((ev) => lastHit.delete(ev.playerId));

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function isHammerable(typeId, hasTag) {
  if (NEVER_BREAK.has(typeId)) return false;
  return hasTag("minecraft:is_pickaxe_item_destructible") || hasTag("stone") || hasTag("metal");
}

/** หน้าบล็อกที่ขุด: ใช้จากการตีจริงถ้าตรงบล็อก ไม่งั้นเดาจากทิศที่มอง */
function minedFace(player, loc) {
  const hit = lastHit.get(player.id);
  if (hit && hit.x === loc.x && hit.y === loc.y && hit.z === loc.z) return hit.face;
  const v = player.getViewDirection();
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ay >= ax && ay >= az) return v.y < 0 ? Direction.Up : Direction.Down;
  if (ax >= az) return v.x < 0 ? Direction.East : Direction.West;
  return v.z < 0 ? Direction.South : Direction.North;
}

/** ตำแหน่งรอบ ๆ บนระนาบที่ตั้งฉากกับหน้าที่ขุด เรียงจากใกล้ไปไกล */
function planeOffsets(face, r) {
  const out = [];
  for (let a = -r; a <= r; a++) {
    for (let b = -r; b <= r; b++) {
      if (a === 0 && b === 0) continue;
      if (face === Direction.Up || face === Direction.Down) out.push({ x: a, y: 0, z: b });
      else if (face === Direction.North || face === Direction.South) out.push({ x: a, y: b, z: 0 });
      else out.push({ x: 0, y: b, z: a });
    }
  }
  return out.sort((p, q) => Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) - Math.max(Math.abs(q.x), Math.abs(q.y), Math.abs(q.z)));
}

function enchantLevel(item, id) {
  try {
    return item.getComponent("minecraft:enchantable")?.getEnchantment(id)?.level ?? 0;
  } catch {
    return 0;
  }
}

/** ทอยว่าเสียความทนทานไหม (Unbreaking: โอกาส 1/(เลเวล+1)) */
function rollWear(unbreaking) {
  return Math.random() < 1 / (unbreaking + 1);
}

function spawnOreXp(dimension, typeId, at) {
  const range = ORE_XP[typeId.replace("lit_", "").replace("deepslate_", "")];
  if (!range) return;
  const n = randInt(range[0], range[1]);
  for (let i = 0; i < n; i++) dimension.spawnEntity("minecraft:xp_orb", at);
}

world.afterEvents.playerBreakBlock.subscribe((ev) => {
  const { player, dimension, brokenBlockPermutation: perm, itemStackBeforeBreak: tool } = ev;
  const radius = tool && HAMMERS[tool.typeId];
  if (!radius) return;

  const creative = player.getGameMode() === GameMode.Creative;
  const origin = ev.block.location;
  const center = { x: origin.x + 0.5, y: origin.y + 0.5, z: origin.z + 0.5 };
  const mainId = perm.type.id;
  const doArea = !(SNEAK_FOR_SINGLE && player.isSneaking) && isHammerable(mainId, (t) => perm.hasTag(t));

  // ความทนทานตอนนี้ (บางเวอร์ชันเกมหักบล็อกตรงกลางให้เองแล้ว เช็กจากของก่อน/หลังขุด)
  const durBefore = tool.getComponent("minecraft:durability");
  const durAfter = ev.itemStackAfterBreak?.getComponent("minecraft:durability");
  if (!durBefore) return;
  if (!creative && !durAfter) return; // ค้อนพังไปแล้ว
  const unbreaking = enchantLevel(tool, "unbreaking");
  const max = durBefore.maxDurability;
  let damage = durAfter ? durAfter.damage : durBefore.damage;
  const engineWore = durAfter && durAfter.damage > durBefore.damage;
  if (!creative && !engineWore && rollWear(unbreaking)) damage++;

  let broke = 0;
  let toolBroken = !creative && damage >= max;
  if (doArea && !toolBroken) {
    const silk = enchantLevel(tool, "silk_touch") > 0;
    const loot = world.getLootTableManager();
    const mainTough = TOUGH.has(mainId);
    for (const o of planeOffsets(minedFace(player, origin), radius)) {
      const loc = { x: origin.x + o.x, y: origin.y + o.y, z: origin.z + o.z };
      let block;
      try {
        block = dimension.getBlock(loc);
      } catch {
        continue;
      }
      if (!block || block.isAir || block.isLiquid) continue;
      const id = block.typeId;
      if (!isHammerable(id, (t) => block.hasTag(t))) continue;
      if (TOUGH.has(id) && !mainTough) continue;
      if (block.getComponent("minecraft:inventory")) continue;

      const at = DROPS_TO_CENTER ? center : { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
      if (creative) {
        block.setType("minecraft:air");
      } else {
        let drops;
        try {
          drops = loot.generateLootFromBlock(block, tool);
        } catch {
          continue;
        }
        if (drops === undefined) continue; // ค้อนระดับต่ำเกินไปสำหรับบล็อกนี้
        block.setType("minecraft:air");
        for (const item of drops) dimension.spawnItem(item, at);
        if (!silk) spawnOreXp(dimension, id, at);
        for (let i = 0; i < WEAR_PER_EXTRA_BLOCK; i++) if (rollWear(unbreaking)) damage++;
      }
      broke++;
      if (!creative && damage >= max) {
        toolBroken = true;
        break;
      }
    }
    if (broke > 0) dimension.playSound("dig.stone", center);
  }

  if (creative) return;
  const eq = player.getComponent("minecraft:equippable");
  const held = eq?.getEquipment(EquipmentSlot.Mainhand);
  if (!held || held.typeId !== tool.typeId) return;
  if (toolBroken) {
    eq.setEquipment(EquipmentSlot.Mainhand, undefined);
    dimension.playSound("random.break", player.location);
    return;
  }
  const dur = held.getComponent("minecraft:durability");
  if (!dur || dur.damage === damage) return;
  dur.damage = damage;
  eq.setEquipment(EquipmentSlot.Mainhand, held);
});

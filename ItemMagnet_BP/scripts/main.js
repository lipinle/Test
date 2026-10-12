// Item Magnet - แม่เหล็กดูดของ
//
// วิธีใช้: ถือ "แม่เหล็กดูดของ" แล้ว "ย่อ" + "กดใช้ค้าง" (มือถือ: แตะหน้าจอค้าง / PC: คลิกขวาค้าง)
//          ไอเท็มที่ตกอยู่ (และลูกแก้วประสบการณ์) ในระยะ 9 บล็อกจะถูกดูดเข้าหาตัว
//
// วิธีได้มา:
//   1) เปิดกล่องสมบัติในแมพ (Chest / Trapped Chest / Barrel ที่ผู้เล่นไม่ได้วางเอง)
//      ครั้งแรกที่เปิด มีโอกาสเจอแม่เหล็กอยู่ในกล่อง
//   2) โหมดโกง: /magnet:magnet [จำนวน] [ผู้เล่น]  หรือ  /give @s magnet:item_magnet
//      หรือ /function magnet

import {
  world,
  system,
  ItemStack,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
} from "@minecraft/server";

// ---------- ตั้งค่า ----------
const MAGNET_ID = "magnet:item_magnet";
const PULL_RADIUS = 9; // ระยะดูด (บล็อก)
const PULL_STEP = 1.0; // ระยะที่ไอเท็มเคลื่อนเข้าหาตัวต่อรอบ (บล็อก)
const PULL_INTERVAL = 2; // ทำงานทุก ๆ กี่ tick
const PULLED_TYPES = ["minecraft:item", "minecraft:xp_orb"];

const LOOT_CHANCE = 0.25; // โอกาสเจอในกล่องสมบัติ (0.25 = 25%)
const LOOT_CONTAINERS = ["minecraft:chest", "minecraft:trapped_chest", "minecraft:barrel"];
const PROP_CHECKED_PREFIX = "magnet:c:"; // จำว่ากล่องนี้สุ่มแล้ว / ผู้เล่นวางเอง

/** ผู้เล่นที่กำลังกดใช้แม่เหล็กค้างอยู่ @type {Set<string>} */
const usingPlayers = new Set();

// ---------- ฟังก์ชันช่วย ----------
function isHoldingMagnet(player) {
  const equip = player.getComponent("minecraft:equippable");
  return equip?.getEquipment("Mainhand")?.typeId === MAGNET_ID;
}

function containerKey(block) {
  const { x, y, z } = block.location;
  return `${PROP_CHECKED_PREFIX}${block.dimension.id}:${x},${y},${z}`;
}

function createMagnet(amount = 1) {
  const item = new ItemStack(MAGNET_ID, amount);
  item.setLore(["§7ย่อ + กดใช้ค้าง", `§7เพื่อดูดไอเท็มในระยะ ${PULL_RADIUS} บล็อก`]);
  return item;
}

// ---------- กดใช้ค้าง ----------
world.afterEvents.itemStartUse.subscribe(({ itemStack, source }) => {
  if (itemStack?.typeId === MAGNET_ID) usingPlayers.add(source.id);
});

world.afterEvents.itemStopUse.subscribe(({ itemStack, source }) => {
  if (itemStack?.typeId === MAGNET_ID) usingPlayers.delete(source.id);
});

world.afterEvents.itemReleaseUse.subscribe(({ itemStack, source }) => {
  if (itemStack?.typeId === MAGNET_ID) usingPlayers.delete(source.id);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => usingPlayers.delete(playerId));

// ---------- ดูดไอเท็ม ----------
function pullItems(player) {
  const target = { x: player.location.x, y: player.location.y + 0.5, z: player.location.z };
  let pulled = 0;

  for (const type of PULLED_TYPES) {
    const entities = player.dimension.getEntities({ type, location: target, maxDistance: PULL_RADIUS });
    for (const entity of entities) {
      if (!entity.isValid) continue;
      const pos = entity.location;
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const dz = target.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 0.5) continue;

      // เคลื่อนเข้าหาผู้เล่นทีละนิด ให้เห็นว่ากำลังลอยเข้ามา
      const step = Math.min(PULL_STEP, dist) / dist;
      try {
        entity.teleport({ x: pos.x + dx * step, y: pos.y + dy * step, z: pos.z + dz * step });
        pulled++;
      } catch {
        // เอนทิตีอาจหายไปแล้ว (ถูกเก็บไปแล้ว)
      }
    }
  }
  return pulled;
}

let tick = 0;
system.runInterval(() => {
  tick += PULL_INTERVAL;
  for (const player of world.getAllPlayers()) {
    if (!usingPlayers.has(player.id)) continue;

    if (!isHoldingMagnet(player)) {
      usingPlayers.delete(player.id);
      continue;
    }
    if (!player.isSneaking) {
      if (tick % 20 === 0) player.onScreenDisplay.setActionBar("§eย่อตัวค้างไว้ เพื่อเปิดแม่เหล็ก");
      continue;
    }

    const pulled = pullItems(player);
    if (tick % 10 === 0) {
      player.onScreenDisplay.setActionBar(
        pulled > 0 ? `§b🧲 กำลังดูดไอเท็ม §f(${pulled})` : "§b🧲 แม่เหล็กทำงาน §7(ไม่มีของในระยะ)"
      );
      try {
        player.dimension.spawnParticle("minecraft:villager_happy", {
          x: player.location.x,
          y: player.location.y + 1,
          z: player.location.z,
        });
      } catch {}
    }
    if (pulled > 0 && tick % 20 === 0) player.playSound("random.orb", { volume: 0.3, pitch: 1.6 });
  }
}, PULL_INTERVAL);

// ---------- ดร็อปในกล่องสมบัติ ----------
// กล่องที่ผู้เล่นวางเอง จะถูกจำไว้ ไม่ให้สุ่มของ
world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
  if (LOOT_CONTAINERS.includes(block.typeId)) world.setDynamicProperty(containerKey(block), true);
});

world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  const { block, player } = event;
  if (event.isFirstEvent === false) return;
  if (!LOOT_CONTAINERS.includes(block.typeId)) return;

  const key = containerKey(block);
  if (world.getDynamicProperty(key)) return;

  // รอให้เกมสุ่มของตาม loot table ลงกล่องก่อน แล้วค่อยใส่แม่เหล็ก
  system.runTimeout(() => {
    try {
      if (!block.isValid || !LOOT_CONTAINERS.includes(block.typeId)) return;
      if (world.getDynamicProperty(key)) return;
      world.setDynamicProperty(key, true);

      const container = block.getComponent("minecraft:inventory")?.container;
      if (!container) return;

      // กล่องว่างเปล่า = ไม่ใช่กล่องสมบัติ
      if (container.emptySlotsCount >= container.size) return;
      if (Math.random() >= LOOT_CHANCE) return;

      const emptySlots = [];
      for (let i = 0; i < container.size; i++) {
        if (!container.getItem(i)) emptySlots.push(i);
      }
      if (emptySlots.length === 0) return;

      const slot = emptySlots[Math.floor(Math.random() * emptySlots.length)];
      container.setItem(slot, createMagnet());
      player.playSound("random.levelup", { volume: 0.5, pitch: 1.5 });
      player.onScreenDisplay.setActionBar("§d✦ พบ §cแม่เหล็กดูดของ §dในกล่องนี้!");
    } catch {
      // บล็อกอาจอยู่นอกพื้นที่ที่โหลด
    }
  }, 2);
});

// ---------- คำสั่งเสก (ต้องเปิดโกง) ----------
system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerCommand(
    {
      name: "magnet:magnet",
      description: "เสกแม่เหล็กดูดของ",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: true,
      optionalParameters: [
        { type: CustomCommandParamType.Integer, name: "amount" },
        { type: CustomCommandParamType.PlayerSelector, name: "target" },
      ],
    },
    (origin, amount, targets) => {
      const count = Math.max(1, Math.min(64, amount ?? 1));
      const sender = origin.sourceEntity;
      const players = targets ?? (sender?.typeId === "minecraft:player" ? [sender] : []);
      if (players.length === 0) {
        return { status: CustomCommandStatus.Failure, message: "ไม่พบผู้เล่นที่จะให้แม่เหล็ก" };
      }

      // callback ของคำสั่งแก้ไขโลกตรง ๆ ไม่ได้ ต้องเลื่อนไป tick ถัดไป
      system.run(() => {
        for (const player of players) {
          const inventory = player.getComponent("minecraft:inventory")?.container;
          for (let i = 0; i < count; i++) {
            const leftover = inventory?.addItem(createMagnet());
            if (leftover) player.dimension.spawnItem(leftover, player.location);
          }
          player.sendMessage(`§aได้รับ §cแม่เหล็กดูดของ §ax${count} §7(ย่อ + กดใช้ค้าง เพื่อดูดไอเท็ม)`);
        }
      });
      return { status: CustomCommandStatus.Success };
    }
  );
});

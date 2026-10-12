// RPG Levels — ระบบเลเวลตัวละคร ค่าสถานะ ความชำนาญอุปกรณ์ และสกิลพิเศษ
//
// เปิดเมนู: ถือ "สมุดสถานะ RPG" แล้วกดใช้ (มือถือ: แตะค้าง / PC: คลิกขวา)
// ได้สมุดฟรีตอนเข้าโลกครั้งแรก, คราฟใหม่ได้จาก หนังสือ + ลาพิส ลาซูลี
// คำสั่ง (ต้องเปิดโกง): /scriptevent rpg:menu  /scriptevent rpg:book
//                     /scriptevent rpg:xp <จำนวน>  /scriptevent rpg:level <เลเวล>

import { ItemStack, Player, system, world } from "@minecraft/server";
import { MENU_ITEM } from "./config.js";
import { initCombat } from "./combat.js";
import { forget, getData, getWorld, isAdmin, saveDirty, saveNow, saveWorld } from "./data.js";
import { initEffects, onPlayerLeave, onPlayerSpawn } from "./effects.js";
import { initGathering } from "./gathering.js";
import { addXp, setLevel, updateNameTag } from "./progression.js";
import { openMain } from "./ui.js";

function giveBook(player) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  const left = inv?.addItem(new ItemStack(MENU_ITEM, 1));
  if (left) player.dimension.spawnItem(left, player.location);
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  onPlayerSpawn(player);
  if (!initialSpawn) return;
  system.runTimeout(() => {
    if (!player.isValid) return;
    const w = getWorld();
    if (!w.ownerId) {
      w.ownerId = player.id; // คนแรกที่เข้าโลก = ผู้ดูแล
      saveWorld();
    }
    const d = getData(player);
    if (!d.gotBook) {
      d.gotBook = true;
      giveBook(player);
      saveNow(player);
      player.sendMessage("§6[RPG] §eยินดีต้อนรับ! ได้รับ §6สมุดสถานะ RPG §e— ถือแล้วกดใช้เพื่อเปิดเมนู");
    }
    updateNameTag(player);
  }, 40);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  onPlayerLeave(playerId);
  forget(playerId);
});

world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (itemStack?.typeId !== MENU_ITEM) return;
  system.run(() => openMain(source));
});

system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
  if (!(sourceEntity instanceof Player)) return;
  const player = sourceEntity;
  const n = Number(message.trim());
  switch (id) {
    case "rpg:menu":
      openMain(player);
      break;
    case "rpg:book":
      giveBook(player);
      break;
    case "rpg:xp":
      if (isAdmin(player) && n > 0) addXp(player, n);
      break;
    case "rpg:level":
      if (isAdmin(player) && n > 0) {
        setLevel(player, n);
        player.sendMessage(`§e[RPG] ตั้งเลเวลเป็น ${getData(player).level}`);
      }
      break;
  }
});

initCombat();
initGathering();
initEffects();

// บันทึกข้อมูลที่เปลี่ยนทุก 1 วินาที
system.runInterval(saveDirty, 20);

import { world, system } from "@minecraft/server";
import * as lib from "./lib.js";
import { registerCommands } from "./commands.js";
import { openMenu } from "./menu.js";

// ลงทะเบียนคำสั่งใหม่ทั้งหมดตอนโลกเริ่ม
system.beforeEvents.startup.subscribe((event) => {
  registerCommands(event.customCommandRegistry);
});

// ถือไม้เมนูโกงแล้วกดใช้ = เปิดเมนู
world.afterEvents.itemUse.subscribe((event) => {
  if (lib.isWand(event.itemStack)) openMenu(event.source);
});

// จำจุดที่ตาย ใช้ /back กลับไปเก็บของได้
world.afterEvents.entityDie.subscribe(
  (event) => {
    const player = event.deadEntity;
    if (player.typeId !== "minecraft:player") return;
    lib.rememberBack(player);
    system.run(() => {
      if (player.isValid) lib.tell(player, "พิมพ์ §e/back§r เพื่อกลับไปจุดที่ตาย");
    });
  },
  { entityTypes: ["minecraft:player"] }
);

// คืนบัฟถาวรทุก 1 วินาที (และทันทีหลังเกิดใหม่)
system.runInterval(() => {
  for (const player of world.getPlayers()) {
    try {
      lib.applyBuffs(player);
    } catch {
      // ผู้เล่นกำลังโหลด / ตายอยู่
    }
  }
}, 20);

world.afterEvents.playerSpawn.subscribe(({ player }) => {
  try {
    lib.applyBuffs(player);
  } catch {
    // ignore
  }
});

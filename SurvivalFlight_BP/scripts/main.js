// Survival Flight - บินได้ในโหมดเอาชีวิตรอด
//
// วิธีใช้: ถือ "ขนนก" (Feather) แล้วกดใช้ (มือถือ: แตะค้าง / PC: คลิกขวา) เพื่อเปิด/ปิดการบิน
//
// มี 2 โหมดการบิน:
//   1) Native  - ถ้าโลกเปิด "Education Edition" ไว้ จะใช้คำสั่ง /ability mayfly
//                บินได้เหมือนโหมดสร้างสรรค์ทุกอย่าง (แตะกระโดด 2 ครั้งเพื่อบิน)
//   2) Scripted - ถ้าไม่ได้เปิด Education Edition สคริปต์จะคุมความเร็วผู้เล่นเอง
//                กดกระโดดค้าง = บินขึ้น, กดย่อ = บินลง, ไม่กดอะไร = ลอยนิ่ง
//                เดินด้วยจอยสติ๊ก = บินไปทางที่มอง, วิ่ง (sprint) = บินเร็วขึ้น

import { world, system, Player } from "@minecraft/server";

// ---------- ตั้งค่า ----------
const TOGGLE_ITEM = "minecraft:feather"; // ไอเท็มที่ใช้เปิด/ปิดการบิน
const FLY_SPEED = 0.5; // ความเร็วบินแนวนอน (บล็อก/tick)
const SPRINT_SPEED = 1.0; // ความเร็วบินตอนวิ่ง
const VERTICAL_SPEED = 0.45; // ความเร็วขึ้น/ลง
const LANDING_PROTECTION_TICKS = 100; // กันตกตายหลังปิดการบิน (5 วินาที)

const PROP_FLYING = "survival_flight:enabled";

/** @type {Map<string, "native" | "scripted">} */
const flyingPlayers = new Map();

// ---------- ฟังก์ชันช่วย ----------
function tryRunCommand(player, command) {
  try {
    player.runCommand(command);
    return true;
  } catch {
    return false; // เช่น คำสั่ง ability ใช้ไม่ได้เพราะไม่ได้เปิด Education Edition
  }
}

function notify(player, text) {
  player.onScreenDisplay.setActionBar(text);
}

function giveSlowFalling(player, ticks) {
  player.addEffect("slow_falling", ticks, { amplifier: 0, showParticles: false });
}

function enableFlight(player, silent = false) {
  const mode = tryRunCommand(player, "ability @s mayfly true") ? "native" : "scripted";
  flyingPlayers.set(player.id, mode);
  player.setDynamicProperty(PROP_FLYING, true);
  if (!silent) {
    notify(
      player,
      mode === "native"
        ? "§a✈ เปิดการบินแล้ว §7(แตะกระโดด 2 ครั้งเพื่อบิน)"
        : "§a✈ เปิดการบินแล้ว §7(กระโดด=ขึ้น, ย่อ=ลง)"
    );
    player.playSound("random.orb");
  }
}

function disableFlight(player) {
  const mode = flyingPlayers.get(player.id);
  flyingPlayers.delete(player.id);
  player.setDynamicProperty(PROP_FLYING, false);
  if (mode === "native") tryRunCommand(player, "ability @s mayfly false");
  // กันตกตายตอนปิดการบินกลางอากาศ
  giveSlowFalling(player, LANDING_PROTECTION_TICKS);
  notify(player, "§c✈ ปิดการบินแล้ว");
  player.playSound("random.fizz");
}

/** แปลงทิศจอยสติ๊กเป็นทิศในโลก ตามทิศที่ผู้เล่นมอง */
function getHorizontalMovement(player) {
  let move;
  try {
    move = player.inputInfo.getMovementVector(); // x = ซ้าย/ขวา, y = หน้า/หลัง
  } catch {
    return undefined;
  }
  if (Math.abs(move.x) < 0.05 && Math.abs(move.y) < 0.05) return { x: 0, z: 0 };

  const view = player.getViewDirection();
  const len = Math.hypot(view.x, view.z) || 1;
  const fx = view.x / len;
  const fz = view.z / len;
  // เวกเตอร์ "ซ้าย" ของผู้เล่น
  const lx = fz;
  const lz = -fx;

  const speed = player.isSprinting ? SPRINT_SPEED : FLY_SPEED;
  return {
    x: (fx * move.y + lx * move.x) * speed,
    z: (fz * move.y + lz * move.x) * speed,
  };
}

/** โหมด scripted: คุมความเร็วผู้เล่นทุก tick */
function tickScriptedFlight(player) {
  const goingUp = player.isJumping;
  const goingDown = player.isSneaking;

  // อยู่บนพื้นและไม่ได้กดกระโดด -> เดินตามปกติ
  if (player.isOnGround && !goingUp) return;

  let vertical = 0;
  if (goingUp) vertical = VERTICAL_SPEED;
  else if (goingDown) vertical = -VERTICAL_SPEED;

  let horizontal = getHorizontalMovement(player);
  if (!horizontal) {
    // สำรอง: ถ้าอ่านจอยไม่ได้ ใช้ความเร็วเดิมของผู้เล่น
    const v = player.getVelocity();
    horizontal = { x: v.x, z: v.z };
  }

  player.applyKnockback(horizontal, vertical);

  // ล้างระยะตกสะสม ไม่ให้โดนดาเมจตอนลงพื้น
  if (system.currentTick % 20 === 0) giveSlowFalling(player, 40);
}

// ---------- อีเวนต์ ----------

// ใช้ขนนกเพื่อเปิด/ปิดการบิน
world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  if (!(player instanceof Player)) return;
  if (event.itemStack?.typeId !== TOGGLE_ITEM) return;

  system.run(() => {
    if (flyingPlayers.has(player.id)) disableFlight(player);
    else enableFlight(player);
  });
});

// เข้าเกมใหม่ / เกิดใหม่ -> คืนสถานะการบินที่เคยเปิดไว้
world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (player.getDynamicProperty(PROP_FLYING) === true) {
    system.run(() => enableFlight(player, true));
  }
});

world.afterEvents.playerLeave.subscribe((event) => {
  flyingPlayers.delete(event.playerId);
});

// ลูปหลัก ทำงานทุก tick
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const mode = flyingPlayers.get(player.id);
    if (mode !== "scripted") continue;
    try {
      tickScriptedFlight(player);
    } catch {
      // ผู้เล่นอาจเพิ่งออกจากเกม / chunk ยังไม่โหลด
    }
  }
});

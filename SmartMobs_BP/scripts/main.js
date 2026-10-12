// Smart Mobs — มอนสเตอร์เก่งขึ้นตามวันเวลาในเกม
//
// - มอนที่เกิดใหม่ได้เกราะ/อาวุธ/เอนชานต์/เอฟเฟกต์ตามระดับของวันนั้น (config.js -> TIERS)
// - AI เพิ่ม: พุ่งกระโจน, กระโดดหาคนต่อเสา, ถอยหนีแล้วยิง, หลบข้าง, เรียกพวก, ล่าเป็นฝูง, ฮึดสู้ (ai.js)
// - ของที่ใส่ให้ดรอปตามโอกาสที่ตั้งไว้เท่านั้น กันฟาร์มเพชร/เนเธอไรต์ฟรี
//
// คำสั่ง (ต้องเปิดโกง):
//   /scriptevent smartmobs:status        ดูวันและระดับปัจจุบัน
//   /scriptevent smartmobs:tier 5        บังคับระดับ (ทดสอบ)
//   /scriptevent smartmobs:tier auto     กลับไปใช้ระดับตามวัน

import { Player, system, world } from "@minecraft/server";
import { aiTick, onHurt } from "./ai.js";
import { ANNOUNCE_TIER_UP, GEAR_DROP_CHANCE, MOB_KIND, TIERS } from "./config.js";
import { GEAR_IDS, GEAR_LORE, MOB_TAG, outfit, usingCommandFallback } from "./gear.js";
import { currentDay, currentTier, currentTierIndex, forcedTier, setForcedTier } from "./tier.js";
import { chance } from "./util.js";

const LAST_TIER_KEY = "smartmobs:lastTier";

// ---------------------------------------------------------------------------
// มอนเกิด -> แต่งตัว
// ---------------------------------------------------------------------------

/** ตำแหน่งที่มอนของเราตายล่าสุด ใช้จับของที่ดรอปออกมา */
let recentDeaths = [];

world.afterEvents.entitySpawn.subscribe((ev) => {
  const entity = ev.entity;
  const type = entity.typeId;
  if (type === "minecraft:item") {
    // ของดรอปอาจเกิดก่อน event มอนตายใน tick เดียวกัน จึงรอ 1 tick ค่อยเช็ก
    system.runTimeout(() => filterDrop(entity), 1);
    return;
  }
  if (!MOB_KIND[type]) return;
  // รอ 1 tick ให้มอนโหลดอุปกรณ์เริ่มต้นเสร็จก่อน
  system.run(() => {
    try {
      if (entity.isValid && !entity.hasTag(MOB_TAG)) outfit(entity, currentTierIndex());
    } catch {
      // มอนหายไปแล้ว
    }
  });
});

// ---------------------------------------------------------------------------
// คุมของดรอป
// ---------------------------------------------------------------------------

world.afterEvents.entityDie.subscribe((ev) => {
  try {
    const dead = ev.deadEntity;
    if (!MOB_KIND[dead.typeId] || !dead.hasTag(MOB_TAG)) return;
    recordDeath(dead);
  } catch {
    // ไม่เป็นไร
  }
});

function recordDeath(entity) {
  recentDeaths.push({ dim: entity.dimension.id, loc: entity.location, tick: system.currentTick });
}

function filterDrop(itemEntity) {
  if (!recentDeaths.length) return;
  const now = system.currentTick;
  recentDeaths = recentDeaths.filter((d) => now - d.tick <= 10);
  if (!itemEntity.isValid) return;
  const stack = itemEntity.getComponent("minecraft:item")?.itemStack;
  if (!stack) return;
  const marked = stack.getLore().includes(GEAR_LORE) || (usingCommandFallback && GEAR_IDS.has(stack.typeId));
  if (!marked) return;
  const p = itemEntity.location;
  const dim = itemEntity.dimension.id;
  const nearDeath = recentDeaths.some(
    (d) => d.dim === dim && Math.hypot(d.loc.x - p.x, d.loc.y - p.y, d.loc.z - p.z) < 3
  );
  if (nearDeath && !chance(GEAR_DROP_CHANCE)) itemEntity.remove();
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

system.runInterval(() => aiTick(currentTier()), 10);

world.afterEvents.entityHurt.subscribe((ev) => {
  try {
    // สำรอง: จำตำแหน่งตายไว้ตั้งแต่ตอนโดนตีจนเลือดหมด เผื่อ entityDie อ่านตำแหน่งไม่ได้
    const victim = ev.hurtEntity;
    if (MOB_KIND[victim.typeId] && victim.hasTag(MOB_TAG)) {
      const hp = victim.getComponent("minecraft:health");
      if (hp && hp.currentValue <= 0) recordDeath(victim);
    }
    onHurt(ev, currentTier());
  } catch {
    // ไม่เป็นไร
  }
});

// ---------------------------------------------------------------------------
// ประกาศเลื่อนระดับ
// ---------------------------------------------------------------------------

function statusText() {
  const day = currentDay();
  const idx = currentTierIndex();
  const tier = TIERS[idx];
  let text = `§6[Smart Mobs]§r วันที่ §e${day}§r — มอนสเตอร์ระดับ §c${idx} (${tier.name})§r`;
  if (forcedTier() >= 0) {
    text += "\n§7(ระดับถูกบังคับไว้ด้วยคำสั่ง — ใช้ /scriptevent smartmobs:tier auto เพื่อยกเลิก)";
  } else if (idx < TIERS.length - 1) {
    const next = TIERS[idx + 1];
    text += `\n§7ระดับถัดไป: ${next.name} ในวันที่ ${next.day} (อีก ${next.day - day} วัน)`;
  } else {
    text += "\n§7ระดับสูงสุดแล้ว ระวังตัวด้วย!";
  }
  return text;
}

system.runInterval(() => {
  const idx = currentTierIndex();
  const last = world.getDynamicProperty(LAST_TIER_KEY);
  if (typeof last === "number" && idx > last && ANNOUNCE_TIER_UP) {
    world.sendMessage(`§4☠ §cวันที่ ${currentDay()}: มอนสเตอร์แข็งแกร่งขึ้น! §7→ §c${TIERS[idx].name}`);
    for (const p of world.getAllPlayers()) {
      try {
        p.playSound("mob.wither.spawn", { volume: 0.4, pitch: 0.8 });
        p.onScreenDisplay.setActionBar(`§cมอนสเตอร์ระดับ ${idx}: ${TIERS[idx].name}`);
      } catch {
        // ไม่เป็นไร
      }
    }
  }
  if (last !== idx) world.setDynamicProperty(LAST_TIER_KEY, idx);
}, 100);

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (ev.initialSpawn) system.runTimeout(() => ev.player.isValid && ev.player.sendMessage(statusText()), 60);
});

// ---------------------------------------------------------------------------
// คำสั่ง
// ---------------------------------------------------------------------------

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (!ev.id.startsWith("smartmobs:")) return;
  const reply = (msg) => (ev.sourceEntity instanceof Player ? ev.sourceEntity.sendMessage(msg) : world.sendMessage(msg));
  const arg = ev.message.trim().toLowerCase();

  switch (ev.id) {
    case "smartmobs:status":
      reply(statusText());
      break;
    case "smartmobs:tier": {
      if (arg === "auto" || arg === "") {
        setForcedTier(-1);
      } else {
        const n = Number.parseInt(arg, 10);
        if (Number.isNaN(n) || n < 0) {
          reply(`§cใช้: /scriptevent smartmobs:tier <0-${TIERS.length - 1} | auto>`);
          return;
        }
        setForcedTier(n);
      }
      // ไม่ประกาศเลื่อนระดับเมื่อเปลี่ยนด้วยคำสั่ง
      world.setDynamicProperty(LAST_TIER_KEY, currentTierIndex());
      reply(statusText());
      break;
    }
    default:
      reply("§7คำสั่ง: smartmobs:status, smartmobs:tier <เลข|auto>");
  }
});

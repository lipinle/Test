// เอฟเฟกต์ต่อเนื่อง: สกิลที่เปิดอยู่, ค่าสถานะ, ของในมือ, แม่เหล็ก, บิน, ร่อนลง, เร่งพืช

import { system, world } from "@minecraft/server";
import { magnetRange, statFx } from "./config.js";
import { getData } from "./data.js";
import { growAround } from "./gathering.js";
import { skillOn } from "./progression.js";
import { isCreative, mainhand, toolCategory } from "./util.js";

// เอฟเฟกต์ของ addon ใส่แบบยาวมาก ๆ เพื่อไม่ต้องใส่ซ้ำบ่อย (มองในที่มืดจะไม่กะพริบ)
// และแยกออกจากยา/บีคอนได้ด้วยระยะเวลา
const OUR_DURATION = 19_000_000;
const OURS_ABOVE = 1_000_000;

const plain = (id) => id.replace("minecraft:", "");

/** @param {import("@minecraft/server").Player} player */
function desiredEffects(player) {
  const d = getData(player);
  /** @type {Map<string, number>} */
  const want = new Map();
  const add = (id, amp) => want.set(id, Math.max(want.get(id) ?? -1, amp));
  const god = skillOn(player, "god") ? 1 : 0;

  // จากค่าสถานะ
  const hpAmp = Math.floor(d.stats.vit / 10) - 1;
  if (hpAmp >= 0) add("health_boost", hpAmp);
  const agiSpeed = statFx.speedLevel(d.stats);
  if (agiSpeed > 0) add("speed", agiSpeed - 1);

  // จากสกิล
  if (skillOn(player, "night_vision")) add("night_vision", 0);
  if (skillOn(player, "speed")) add("speed", (d.level >= 60 ? 1 : 0) + god);
  if (skillOn(player, "jump")) add("jump_boost", 1 + god);
  if (skillOn(player, "water_breathing")) add("water_breathing", 0);
  if (skillOn(player, "fire_resist")) add("fire_resistance", 0);
  if (skillOn(player, "haste")) add("haste", (d.level >= 70 ? 1 : 0) + god);
  if (skillOn(player, "regen")) add("regeneration", god);
  if (skillOn(player, "invisible")) add("invisibility", 0);
  if (skillOn(player, "strength")) add("strength", (d.level >= 85 ? 1 : 0) + god);
  if (skillOn(player, "guardian")) add("resistance", god);

  // จากความชำนาญของที่ถืออยู่
  const cat = toolCategory(mainhand(player));
  const lv = cat ? d.prof[cat].level : 0;
  if (cat === "pickaxe" || cat === "shovel") {
    if (lv >= 30) add("haste", 1);
    else if (lv >= 10) add("haste", 0);
  }
  if (cat === "axe" && lv >= 20) add("haste", 0);
  if (cat === "trident") {
    if (lv >= 20) add("dolphins_grace", 0);
    if (lv >= 40) add("conduit_power", 0);
  }
  return want;
}

function applyEffects(player) {
  const want = desiredEffects(player);
  for (const [id, amp] of want) {
    const cur = player.getEffect(id);
    if (cur) {
      const ours = cur.duration > OURS_ABOVE;
      if (ours && cur.amplifier === amp) continue;
      if (!ours && cur.amplifier > amp) continue; // ยา/บีคอนแรงกว่า ปล่อยไว้
      if (ours) player.removeEffect(id); // ระดับเปลี่ยน
    }
    player.addEffect(id, OUR_DURATION, { amplifier: amp, showParticles: false });
  }
  // ถอดเอฟเฟกต์ของเราที่ไม่ต้องการแล้ว (ปิดสกิล / เปลี่ยนของในมือ)
  for (const effect of player.getEffects()) {
    if (effect.duration > OURS_ABOVE && !want.has(plain(effect.typeId))) player.removeEffect(effect.typeId);
  }
}

// ---------------------------------------------------------------------------
// บิน (สกิล Lv.30) — ใช้ /ability ถ้าเปิด Education Edition ไว้ ไม่งั้นคุมความเร็วเอง
// ---------------------------------------------------------------------------

/** @type {Map<string, "native" | "scripted">} */
const flying = new Map();

function tryCommand(player, command) {
  try {
    player.runCommand(command);
    return true;
  } catch {
    return false;
  }
}

function setFlight(player, enabled) {
  const mode = flying.get(player.id);
  if (enabled && !mode) {
    const next = tryCommand(player, "ability @s mayfly true") ? "native" : "scripted";
    flying.set(player.id, next);
    player.onScreenDisplay.setActionBar(
      next === "native" ? "§aบินได้แล้ว §7(แตะกระโดด 2 ครั้งเพื่อบิน)" : "§aบินได้แล้ว §7(กระโดดค้าง=ขึ้น, ย่อ=ลง)"
    );
  } else if (!enabled && mode) {
    flying.delete(player.id);
    if (mode === "native") tryCommand(player, "ability @s mayfly false");
    player.addEffect("slow_falling", 100, { amplifier: 0, showParticles: false });
    player.onScreenDisplay.setActionBar("§cปิดการบินแล้ว");
  }
}

function flightMove(player) {
  let move;
  try {
    move = player.inputInfo.getMovementVector(); // x = ซ้าย/ขวา, y = หน้า/หลัง
  } catch {
    const v = player.getVelocity();
    return { x: v.x, z: v.z };
  }
  if (Math.abs(move.x) < 0.05 && Math.abs(move.y) < 0.05) return { x: 0, z: 0 };
  const view = player.getViewDirection();
  const len = Math.hypot(view.x, view.z) || 1;
  const fx = view.x / len;
  const fz = view.z / len;
  const agi = getData(player).stats.agi;
  const speed = (player.isSprinting ? 1.0 : 0.5) + agi * 0.003;
  return {
    x: (fx * move.y + fz * move.x) * speed,
    z: (fz * move.y - fx * move.x) * speed,
  };
}

function tickScriptedFlight(player) {
  const up = player.isJumping;
  const down = player.isSneaking;
  if (player.isOnGround && !up) return;
  const vertical = up ? 0.45 : down ? -0.45 : 0;
  player.applyKnockback(flightMove(player), vertical);
  if (system.currentTick % 20 === 0) player.addEffect("slow_falling", 40, { amplifier: 0, showParticles: false });
}

// ---------------------------------------------------------------------------
// แม่เหล็ก
// ---------------------------------------------------------------------------

/** tick แรกที่เห็นไอเท็ม — ไม่ดูดของที่เพิ่งโยนออกมา */
const firstSeen = new Map();

function tickMagnet(player) {
  const d = getData(player);
  const max = magnetRange(d.level);
  const range = d.settings.magnetRange > 0 ? Math.min(d.settings.magnetRange, max) : max;
  const now = system.currentTick;
  const loc = player.location;
  for (const type of ["minecraft:item", "minecraft:xp_orb"]) {
    for (const ent of player.dimension.getEntities({ type, location: loc, maxDistance: range })) {
      const seen = firstSeen.get(ent.id);
      if (seen === undefined) {
        firstSeen.set(ent.id, now);
        continue;
      }
      if (now - seen < 20) continue;
      ent.teleport(loc);
    }
  }
}

// ---------------------------------------------------------------------------

export function onPlayerSpawn(player) {
  flying.delete(player.id); // ลูปจะเปิดการบินให้ใหม่ถ้ายังเปิดสกิลอยู่
}

export function onPlayerLeave(playerId) {
  flying.delete(playerId);
}

export function initEffects() {
  // ทุก 10 tick: เอฟเฟกต์ / บิน / ฟื้นเลือด / พืช / อิ่มทิพย์
  system.runInterval(() => {
    const tick = system.currentTick;
    for (const player of world.getAllPlayers()) {
      try {
        applyEffects(player);
        setFlight(player, skillOn(player, "flight"));

        const d = getData(player);
        if (tick % 20 === 0 && d.stats.vit > 0) {
          const hp = player.getComponent("minecraft:health");
          if (hp && hp.currentValue > 0 && hp.currentValue < hp.effectiveMax) {
            hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + statFx.regenPerSec(d.stats)));
          }
        }
        if (tick % 40 === 0) {
          if (skillOn(player, "growth")) growAround(player.dimension, player.location, 5, 12);
          if (toolCategory(mainhand(player)) === "hoe" && d.prof.hoe.level >= 30) {
            growAround(player.dimension, player.location, 3, 6);
          }
        }
        if (tick % 400 === 0 && skillOn(player, "satiety")) {
          player.addEffect("saturation", 1, { amplifier: 1, showParticles: false });
        }
      } catch {
        // ผู้เล่นกำลังโหลด / เพิ่งออก
      }
    }
  }, 10);

  // ทุก tick: บินแบบสคริปต์ และร่อนลงนุ่มนวล
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      try {
        const mode = flying.get(player.id);
        if (mode === "scripted" && !isCreative(player)) {
          tickScriptedFlight(player);
          continue;
        }
        if (
          system.currentTick % 2 === 0 &&
          !player.isOnGround &&
          !player.isGliding &&
          !player.isFlying &&
          player.getVelocity().y < -0.6 &&
          skillOn(player, "soft_landing")
        ) {
          player.addEffect("slow_falling", 40, { amplifier: 0, showParticles: false });
        }
      } catch {
        // ไม่เป็นไร
      }
    }
  });

  // ทุก 4 tick: แม่เหล็ก
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      try {
        if (!player.isSneaking && skillOn(player, "magnet")) tickMagnet(player);
      } catch {
        // ไม่เป็นไร
      }
    }
  }, 4);

  system.runInterval(() => {
    const now = system.currentTick;
    for (const [id, t] of firstSeen) if (now - t > 1200) firstSeen.delete(id);
  }, 1200);
}

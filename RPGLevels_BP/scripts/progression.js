// ระบบ XP / เลเวลตัวละคร / เลเวลความชำนาญ และแถบแสดงผล

import { system } from "@minecraft/server";
import {
  BONUS_POINTS,
  BONUS_POINTS_EVERY,
  MAX_LEVEL,
  MAX_PROF_LEVEL,
  POINTS_PER_LEVEL,
  PROFS,
  SKILLS,
  SKILL_BY_ID,
  profXpToNext,
  rankOf,
  statFx,
  xpToNext,
} from "./config.js";
import { getData, getWorld, markDirty, saveNow } from "./data.js";

/** สกิลนี้ปลดล็อกแล้วและผู้เล่นเปิดใช้อยู่ไหม */
export function skillOn(player, skillId) {
  const d = getData(player);
  return d.skills[skillId] === true && d.level >= SKILL_BY_ID[skillId].level;
}

export function profLevel(player, profId) {
  return getData(player).prof[profId]?.level ?? 0;
}

export function progressBar(value, max, length = 20) {
  const filled = Math.max(0, Math.min(length, Math.round((value / Math.max(1, max)) * length)));
  return "§a" + "|".repeat(filled) + "§8" + "|".repeat(length - filled);
}

// ---------------------------------------------------------------------------
// แถบแสดง XP ที่ได้ (Action bar) — รวมยอดที่ได้ใน 2 วินาทีล่าสุด
// ---------------------------------------------------------------------------

/** @type {Map<string, { xp: number, prof: Record<string, number>, until: number }>} */
const hud = new Map();

function showHud(player) {
  const d = getData(player);
  if (!d.settings.hud) return;
  const h = hud.get(player.id);
  if (!h) return;
  let text = "";
  if (h.xp > 0) text += `§a+${Math.round(h.xp)} XP  `;
  for (const [id, amount] of Object.entries(h.prof)) {
    text += `§b+${Math.round(amount)} ${PROFS[id].name}  `;
  }
  if (d.level >= MAX_LEVEL) {
    text += "§6Lv.MAX";
  } else {
    const need = xpToNext(d.level);
    text += `§eLv.${d.level} ${progressBar(d.xp, need)} §f${Math.floor((d.xp / need) * 100)}%`;
  }
  player.onScreenDisplay.setActionBar(text);
}

function hudEntry(player) {
  let h = hud.get(player.id);
  if (!h || h.until < system.currentTick) {
    h = { xp: 0, prof: {}, until: 0 };
    hud.set(player.id, h);
  }
  h.until = system.currentTick + 40;
  return h;
}

// ---------------------------------------------------------------------------
// XP ตัวละคร
// ---------------------------------------------------------------------------

/**
 * เพิ่ม XP ตัวละคร (คูณตัวคูณของโลก และโบนัสจากโชค)
 * @param {import("@minecraft/server").Player} player
 * @param {number} amount
 */
export function addXp(player, amount) {
  if (amount <= 0) return;
  const d = getData(player);
  if (d.level >= MAX_LEVEL) return;

  const gained = amount * getWorld().xpMult * (1 + statFx.xpBonus(d.stats));
  const total = d.frac + gained;
  const whole = Math.floor(total);
  d.frac = total - whole;
  d.xp += whole;
  hudEntry(player).xp += gained;

  const oldLevel = d.level;
  while (d.level < MAX_LEVEL && d.xp >= xpToNext(d.level)) {
    d.xp -= xpToNext(d.level);
    d.level++;
    d.points += POINTS_PER_LEVEL;
    if (d.level % BONUS_POINTS_EVERY === 0) d.points += BONUS_POINTS;
  }
  if (d.level >= MAX_LEVEL) d.xp = 0;

  markDirty(player);
  if (d.level > oldLevel) onLevelUp(player, oldLevel, d.level);
  showHud(player);
}

function onLevelUp(player, oldLevel, newLevel) {
  const d = getData(player);
  saveNow(player);
  updateNameTag(player);

  player.onScreenDisplay.setTitle("§6§lLEVEL UP!", {
    subtitle: `§eเลเวล ${newLevel}  ${rankOf(newLevel)}`,
    fadeInDuration: 5,
    stayDuration: 40,
    fadeOutDuration: 10,
  });
  player.playSound("random.levelup");
  try {
    player.dimension.spawnParticle("minecraft:totem_particle", player.location);
  } catch {
    // ไม่มี particle นี้ก็ไม่เป็นไร
  }

  player.sendMessage(`§6[RPG] §eเลเวลอัพเป็น §l${newLevel}§r§e! §7(แต้มสถานะคงเหลือ §a${d.points}§7 — เปิดสมุดสถานะเพื่ออัพ)`);
  for (const skill of SKILLS) {
    if (skill.level > oldLevel && skill.level <= newLevel) {
      player.sendMessage(`§d[สกิลใหม่] §f${skill.name} §7— ${skill.desc} §8(เปิดใช้ในเมนูสกิล)`);
    }
  }
}

/** ใส่เลเวลไว้เหนือชื่อผู้เล่น */
export function updateNameTag(player) {
  try {
    if (!getWorld().nameTag) {
      if (player.nameTag !== player.name) player.nameTag = player.name;
      return;
    }
    player.nameTag = `§e[Lv.${getData(player).level}] §f${player.name}`;
  } catch {
    // บางเวอร์ชันอาจห้ามตั้งชื่อผู้เล่น
  }
}

/** ตั้งเลเวลโดยตรง (คำสั่งแอดมิน) — คืนแต้มสถานะให้ตรงกับเลเวล */
export function setLevel(player, level) {
  const d = getData(player);
  const target = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  d.level = target;
  d.xp = 0;
  d.frac = 0;
  const spent = Object.values(d.stats).reduce((a, b) => a + b, 0);
  d.points = Math.max(0, totalPointsAt(target) - spent);
  saveNow(player);
  updateNameTag(player);
}

export function totalPointsAt(level) {
  return (level - 1) * POINTS_PER_LEVEL + Math.floor(level / BONUS_POINTS_EVERY) * BONUS_POINTS;
}

// ---------------------------------------------------------------------------
// XP ความชำนาญอุปกรณ์
// ---------------------------------------------------------------------------

/**
 * @param {import("@minecraft/server").Player} player
 * @param {keyof typeof PROFS} profId
 * @param {number} amount
 */
export function addProfXp(player, profId, amount) {
  if (amount <= 0) return;
  const d = getData(player);
  const p = d.prof[profId];
  if (!p || p.level >= MAX_PROF_LEVEL) return;

  const gained = Math.max(1, Math.round(amount * getWorld().xpMult));
  p.xp += gained;
  const h = hudEntry(player);
  h.prof[profId] = (h.prof[profId] ?? 0) + gained;

  const oldLevel = p.level;
  while (p.level < MAX_PROF_LEVEL && p.xp >= profXpToNext(p.level)) {
    p.xp -= profXpToNext(p.level);
    p.level++;
  }
  if (p.level >= MAX_PROF_LEVEL) p.xp = 0;
  markDirty(player);

  if (p.level > oldLevel) {
    saveNow(player);
    const prof = PROFS[profId];
    player.sendMessage(`§b[ความชำนาญ] §f${prof.name} §bเลเวล ${p.level}`);
    player.playSound("random.orb", { pitch: 1.4 });
    for (const perk of prof.perks) {
      if (perk.level > oldLevel && perk.level <= p.level) {
        player.sendMessage(`§6  ปลดล็อกเอฟเฟกต์: §e${perk.text}`);
        player.onScreenDisplay.setTitle(" ", { subtitle: `§6${prof.name} Lv.${perk.level}: §e${perk.text}`, fadeInDuration: 0, stayDuration: 50, fadeOutDuration: 10 });
      }
    }
  }
  showHud(player);
}

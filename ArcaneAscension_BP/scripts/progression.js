import { world, system } from "@minecraft/server";
import {
  MAX_LEVEL, POINTS_PER_LEVEL, xpToNext, BASE_MANA, MANA_PER_WIS, MANA_PER_LEVEL, BASE_REGEN, REGEN_PER_WIS,
  ARMOR_SETS, QUESTS, SPELLS, SPELL_ORDER, KILL_XP, MONSTER_XP, OTHER_XP,
} from "./config.js";
import { getData, markDirty, saveData } from "./data.js";
import { armorOf, refreshArmor } from "./combat.js";
import { fx, COL, psound } from "./fx.js";
import { alive, title, tell, giveItem, safe, playersNear, itemName } from "./util.js";

// ---------- มานา ----------
export function maxMana(player, d = getData(player)) {
  const sets = armorOf(player);
  return BASE_MANA + d.attr.wis * MANA_PER_WIS + (d.lvl - 1) * MANA_PER_LEVEL + sets.archmage * ARMOR_SETS.archmage.manaPerPiece;
}

export function manaRegen(player, d = getData(player)) {
  const sets = armorOf(player);
  let r = BASE_REGEN + d.attr.wis * REGEN_PER_WIS;
  if (sets.archmage >= 4) r *= 1.75;
  return r;
}

export function addMana(player, amount) {
  const d = getData(player);
  d.mana = Math.max(0, Math.min(maxMana(player, d), d.mana + amount));
  markDirty(player);
}

// ---------- XP / เลเวล ----------
const xpPopups = new Map(); // player.id -> { amount, until }

export function lastXpPopup(player) {
  const p = xpPopups.get(player.id);
  return p && p.until > system.currentTick ? p.amount : 0;
}

export function addXp(player, amount, silent = false) {
  if (amount <= 0) return;
  const d = getData(player);
  if (d.lvl >= MAX_LEVEL) return;
  amount = Math.round(amount);
  d.xp += amount;
  if (!silent) {
    const prev = xpPopups.get(player.id);
    const acc = prev && prev.until > system.currentTick ? prev.amount + amount : amount;
    xpPopups.set(player.id, { amount: acc, until: system.currentTick + 50 });
  }
  let leveled = false;
  while (d.lvl < MAX_LEVEL && d.xp >= xpToNext(d.lvl)) {
    d.xp -= xpToNext(d.lvl);
    d.lvl++;
    d.pts += POINTS_PER_LEVEL;
    leveled = true;
    onLevelUp(player, d);
  }
  if (d.lvl >= MAX_LEVEL) d.xp = 0;
  markDirty(player);
  if (leveled) saveData(player);
}

function onLevelUp(player, d) {
  const dim = player.dimension;
  title(player, `§6§l✦ เลเวล ${d.lvl} ✦`, `§eได้แต้มค่าสถานะ +${POINTS_PER_LEVEL} §7(เปิดคัมภีร์เพื่ออัปค่าสถานะ)`, 5, 50, 15);
  psound(player, "random.levelup", 1, 0.9);
  fx.rise(dim, player.location, COL.gold, 1.2, 30, 3, 0.18);
  fx.rune(dim, player.location, 2.2, COL.gold, 1.6, 90);
  d.mana = maxMana(player, d);
  const newSpells = SPELL_ORDER.filter((id) => SPELLS[id].level === d.lvl);
  for (const id of newSpells) tell(player, `§d✦ เรียนคาถาใหม่ได้แล้ว: §f${SPELLS[id].name} §7(คัมภีร์ → คาถา)`);
  questProgress(player, "level", undefined, d.lvl, true);
}

export function setLevel(player, lvl) {
  const d = getData(player);
  const target = Math.max(1, Math.min(MAX_LEVEL, lvl));
  const spent = d.attr.int + d.attr.wis + d.attr.vit + d.attr.cel;
  d.lvl = target;
  d.xp = 0;
  d.pts = Math.max(0, (target - 1) * POINTS_PER_LEVEL - spent);
  d.mana = maxMana(player, d);
  questProgress(player, "level", undefined, d.lvl, true);
  saveData(player);
}

// ---------- ภารกิจ ----------
export function questState(d, q) {
  const s = d.quests[q.id] ?? { p: 0, c: false };
  return { p: s.p, c: s.c, done: s.p >= q.count };
}

export function questProgress(player, type, target, amount = 1, absolute = false) {
  const d = getData(player);
  for (const q of QUESTS) {
    if (q.type !== type) continue;
    if (q.target !== undefined && q.target !== target) continue;
    const s = d.quests[q.id] ?? { p: 0, c: false };
    if (s.p >= q.count) continue;
    s.p = absolute ? Math.max(s.p, amount) : s.p + amount;
    d.quests[q.id] = s;
    if (s.p >= q.count) {
      title(player, "§a§lภารกิจสำเร็จ!", `§f${q.name} §7— เปิดคัมภีร์เพื่อรับรางวัล`, 5, 60, 15);
      psound(player, "random.toast", 1, 1.2);
      tell(player, `§a✔ ภารกิจสำเร็จ: §f${q.name}`);
    }
    markDirty(player);
  }
}

export function claimQuest(player, q) {
  const d = getData(player);
  const s = questState(d, q);
  if (!s.done || s.c) return false;
  d.quests[q.id] = { p: s.p, c: true };
  addXp(player, q.xp);
  for (const [id, n] of q.items ?? []) giveItem(player, id, n);
  psound(player, "random.levelup", 0.8, 1.3);
  fx.rise(player.dimension, player.location, COL.nature, 1, 20, 2.5);
  tell(player, { rawtext: [{ text: `§a✔ รับรางวัล "${q.name}": §e+${q.xp} XP` }, ...(q.items ?? []).flatMap(([id, n]) => [{ text: ` §f${n}x ` }, itemName(id)])] });
  saveData(player);
  return true;
}

export function claimableCount(d) {
  return QUESTS.filter((q) => {
    const s = questState(d, q);
    return s.done && !s.c;
  }).length;
}

// ---------- รางวัลการฆ่า ----------
let bloodMoonActive = () => false;
export function setBloodMoonProbe(fn) {
  bloodMoonActive = fn;
}

function ownerOf(entity) {
  if (!entity) return undefined;
  if (entity.typeId === "minecraft:player") return entity;
  const id = safe(() => entity.getDynamicProperty("arc:owner"));
  if (typeof id === "string") {
    const p = world.getEntity(id);
    if (p?.typeId === "minecraft:player") return p;
  }
  const tamer = safe(() => entity.getComponent("minecraft:tameable")?.tamedToPlayer);
  return tamer ?? undefined;
}

function awardKill(player, dead, typeId, isMonster) {
  const d = getData(player);
  let xp = KILL_XP[typeId] ?? (isMonster ? MONSTER_XP : OTHER_XP);
  const bm = bloodMoonActive();
  if (bm && isMonster) xp *= 2;
  addXp(player, xp);
  if (typeId.startsWith("arc:")) d.kills[typeId] = (d.kills[typeId] ?? 0) + 1;
  questProgress(player, "kill", typeId);
  if (bm && isMonster) {
    d.st.bm++;
    questProgress(player, "bloodmoon");
  }
  markDirty(player);
}

export function initProgression() {
  world.afterEvents.entityDie.subscribe((ev) => {
    const dead = ev.deadEntity;
    let typeId;
    let isMonster = false;
    let loc;
    let dim;
    try {
      typeId = dead.typeId;
      if (typeId === "minecraft:player") return;
      isMonster = dead.matches({ families: ["monster"] });
      loc = dead.location;
      dim = dead.dimension;
    } catch {
      return;
    }
    const isBoss = typeId === "arc:ember_colossus" || typeId === "arc:void_titan";
    if (isBoss) {
      // บอส: ทุกคนที่อยู่ใกล้ได้เครดิตเต็ม
      for (const p of playersNear(dim, loc, 64, true)) {
        awardKill(p, dead, typeId, true);
        questProgress(p, "boss", typeId);
      }
      return;
    }
    const killer = ownerOf(ev.damageSource.damagingEntity);
    if (killer && alive(killer)) awardKill(killer, dead, typeId, isMonster);
  });

  // ค่าสถานะ VIT / โบนัสชุดเกราะ / มานา
  system.runInterval(() => {
    for (const p of world.getAllPlayers()) {
      const sets = refreshArmor(p);
      const d = getData(p);
      const amp = Math.min(9, Math.floor(d.attr.vit / 3) - 1);
      if (amp >= 0) {
        const cur = p.getEffect("health_boost");
        if (cur && cur.amplifier !== amp) safe(() => p.removeEffect("health_boost"));
        if (!cur || cur.amplifier !== amp || cur.duration < 200) {
          safe(() => p.addEffect("health_boost", 600, { amplifier: amp, showParticles: false }));
        }
      }
      if (sets.voidplate >= 4) {
        const r = p.getEffect("resistance");
        if (!r || r.duration < 60) safe(() => p.addEffect("resistance", 200, { amplifier: 0, showParticles: false }));
      }
    }
  }, 20);

  system.runInterval(() => {
    for (const p of world.getAllPlayers()) {
      const d = getData(p);
      const max = maxMana(p, d);
      if (d.mana < max) d.mana = Math.min(max, d.mana + manaRegen(p, d) / 4);
      else if (d.mana > max) d.mana = max;
    }
  }, 5);
}

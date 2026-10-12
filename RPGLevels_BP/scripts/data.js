// เก็บ/โหลดข้อมูลผู้เล่นใน Dynamic Property (JSON) และตั้งค่าของโลก

import { world } from "@minecraft/server";
import { PROF_IDS, STAT_IDS, SKILLS } from "./config.js";

const DATA_KEY = "rpg:data";
const WORLD_KEY = "rpg:world";

/** @typedef {{ level: number, xp: number }} ProfData */
/**
 * @typedef {{
 *   level: number, xp: number, frac: number, points: number,
 *   stats: Record<string, number>,
 *   prof: Record<string, ProfData>,
 *   skills: Record<string, boolean>,
 *   settings: { hud: boolean, veinSneak: boolean, treeSneak: boolean, treeLeaves: boolean, magnetRange: number },
 *   cd: Record<string, number>,
 *   gotBook: boolean,
 * }} PlayerData
 */

/** @returns {PlayerData} */
function defaultData() {
  return {
    level: 1,
    xp: 0,
    frac: 0, // เศษ XP ทศนิยมที่ยังไม่ครบ 1
    points: 0,
    stats: Object.fromEntries(STAT_IDS.map((id) => [id, 0])),
    prof: Object.fromEntries(PROF_IDS.map((id) => [id, { level: 0, xp: 0 }])),
    skills: Object.fromEntries(SKILLS.map((s) => [s.id, false])),
    settings: { hud: true, veinSneak: false, treeSneak: false, treeLeaves: true, magnetRange: 0 },
    cd: {},
    gotBook: false,
  };
}

/** รวมข้อมูลที่โหลดมากับค่าเริ่มต้น เผื่อเวอร์ชันใหม่มีฟิลด์เพิ่ม */
function merge(saved) {
  const d = defaultData();
  if (!saved || typeof saved !== "object") return d;
  for (const key of ["level", "xp", "frac", "points", "gotBook"]) {
    if (typeof saved[key] === typeof d[key]) d[key] = saved[key];
  }
  for (const group of ["stats", "skills", "settings", "cd"]) {
    if (saved[group] && typeof saved[group] === "object") Object.assign(d[group], saved[group]);
  }
  if (saved.prof && typeof saved.prof === "object") {
    for (const id of PROF_IDS) {
      const p = saved.prof[id];
      if (p && typeof p.level === "number" && typeof p.xp === "number") d.prof[id] = { level: p.level, xp: p.xp };
    }
  }
  return d;
}

/** @type {Map<string, PlayerData>} */
const cache = new Map();
/** @type {Set<string>} */
const dirty = new Set();

/** @param {import("@minecraft/server").Player} player */
export function getData(player) {
  let d = cache.get(player.id);
  if (!d) {
    let saved;
    try {
      const raw = player.getDynamicProperty(DATA_KEY);
      if (typeof raw === "string") saved = JSON.parse(raw);
    } catch {
      saved = undefined;
    }
    d = merge(saved);
    cache.set(player.id, d);
  }
  return d;
}

/** บอกว่าข้อมูลเปลี่ยน — จะถูกบันทึกในรอบถัดไป */
export function markDirty(player) {
  dirty.add(player.id);
}

/** บันทึกทันที (ใช้หลังเลเวลอัพ / เปลี่ยนค่าในเมนู) */
export function saveNow(player) {
  const d = cache.get(player.id);
  if (!d) return;
  try {
    player.setDynamicProperty(DATA_KEY, JSON.stringify(d));
    dirty.delete(player.id);
  } catch {
    // ผู้เล่นอาจออกไปแล้ว
  }
}

/** บันทึกทุกคนที่ข้อมูลเปลี่ยน (เรียกเป็นระยะจาก main.js) */
export function saveDirty() {
  if (dirty.size === 0) return;
  for (const player of world.getAllPlayers()) {
    if (dirty.has(player.id)) saveNow(player);
  }
}

export function resetData(player) {
  cache.set(player.id, defaultData());
  saveNow(player);
}

export function forget(playerId) {
  cache.delete(playerId);
  dirty.delete(playerId);
}

// ---------------------------------------------------------------------------
// ตั้งค่าของโลก (แอดมินปรับได้)
// ---------------------------------------------------------------------------

/** @typedef {{ xpMult: number, nameTag: boolean, ownerId: string }} WorldSettings */

/** @type {WorldSettings | undefined} */
let worldCache;

/** @returns {WorldSettings} */
export function getWorld() {
  if (!worldCache) {
    worldCache = { xpMult: 1, nameTag: true, ownerId: "" };
    try {
      const raw = world.getDynamicProperty(WORLD_KEY);
      if (typeof raw === "string") Object.assign(worldCache, JSON.parse(raw));
    } catch {
      // ใช้ค่าเริ่มต้น
    }
  }
  return worldCache;
}

export function saveWorld() {
  world.setDynamicProperty(WORLD_KEY, JSON.stringify(getWorld()));
}

/** แอดมิน = ผู้เล่นคนแรกที่เข้าโลก (เจ้าของโลก) หรือมีแท็ก rpg_admin */
export function isAdmin(player) {
  return player.hasTag("rpg_admin") || getWorld().ownerId === player.id;
}

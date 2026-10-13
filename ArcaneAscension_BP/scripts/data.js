import { world, system } from "@minecraft/server";
import { DEFAULT_SETTINGS, DEFAULT_WORLD, BASE_MANA } from "./config.js";

// ข้อมูลผู้เล่นเก็บเป็น JSON ใน Dynamic Property ของผู้เล่น
const KEY = "arc:data";
const cache = new Map(); // player.id -> data
const dirty = new Set();

function defaults() {
  return {
    v: 1,
    lvl: 1,
    xp: 0,
    pts: 0,
    attr: { int: 0, wis: 0, vit: 0, cel: 0 },
    mana: BASE_MANA,
    known: ["arcane_bolt"],
    loadout: ["arcane_bolt", null, null, null],
    sel: 0,
    quests: {}, // id -> { p: progress, c: claimed }
    kills: {}, // typeId -> count
    ways: [], // waystone ids ที่ค้นพบ
    rift: { clears: { 1: 0, 2: 0, 3: 0 }, best: {} },
    set: { ...DEFAULT_SETTINGS },
    st: { casts: 0, mana: 0, ore: 0, bm: 0 },
    home: null, // จุดกลับจากรอยแยก { dim, x, y, z }
    riftId: null, // รอยแยกที่กำลังเข้าร่วม
  };
}

function merge(base, saved) {
  for (const k of Object.keys(saved)) {
    if (saved[k] && typeof saved[k] === "object" && !Array.isArray(saved[k]) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
      merge(base[k], saved[k]);
    } else {
      base[k] = saved[k];
    }
  }
  return base;
}

export function getData(player) {
  let d = cache.get(player.id);
  if (d) return d;
  d = defaults();
  try {
    const raw = player.getDynamicProperty(KEY);
    if (typeof raw === "string") merge(d, JSON.parse(raw));
  } catch (err) {
    console.warn(`[Arcane] load data failed: ${err}`);
  }
  if (!Array.isArray(d.loadout) || d.loadout.length !== 4) d.loadout = ["arcane_bolt", null, null, null];
  cache.set(player.id, d);
  return d;
}

export function markDirty(player) {
  dirty.add(player.id);
}

export function saveData(player) {
  const d = cache.get(player.id);
  if (!d) return;
  try {
    player.setDynamicProperty(KEY, JSON.stringify(d));
    dirty.delete(player.id);
  } catch (err) {
    console.warn(`[Arcane] save data failed: ${err}`);
  }
}

export function resetData(player) {
  cache.set(player.id, defaults());
  saveData(player);
}

export function forget(playerId) {
  cache.delete(playerId);
  dirty.delete(playerId);
}

export function flushAll() {
  for (const p of world.getAllPlayers()) if (dirty.has(p.id)) saveData(p);
}

// ---------- ข้อมูลระดับโลก ----------
const worldCache = new Map();

export function getWorld(key, fallback) {
  if (worldCache.has(key)) return worldCache.get(key);
  let v = fallback;
  try {
    const raw = world.getDynamicProperty(key);
    if (typeof raw === "string") v = JSON.parse(raw);
  } catch (err) {
    console.warn(`[Arcane] load world ${key} failed: ${err}`);
  }
  worldCache.set(key, v);
  return v;
}

export function setWorld(key, value) {
  worldCache.set(key, value);
  try {
    world.setDynamicProperty(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[Arcane] save world ${key} failed: ${err}`);
  }
}

export function worldSettings() {
  const s = getWorld("arc:world", { ...DEFAULT_WORLD });
  for (const k of Object.keys(DEFAULT_WORLD)) if (!(k in s)) s[k] = DEFAULT_WORLD[k];
  return s;
}

export function saveWorldSettings(s) {
  setWorld("arc:world", s);
}

export function startAutosave() {
  system.runInterval(flushAll, 100);
}

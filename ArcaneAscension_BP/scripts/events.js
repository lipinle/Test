import { world, system, GameMode } from "@minecraft/server";
import { BLOOD_MOON_EVERY, BLOOD_MOON_RANDOM, BLOOD_MOON_MOBS, BLOOD_MOON_MAX_PER_PLAYER } from "./config.js";
import { getWorld, setWorld, worldSettings } from "./data.js";
import { fx, COL, sound, pushFog, popFog } from "./fx.js";
import { V, rand, pick, chance, safe, title, groundY, onCircle } from "./util.js";

// ---------- จันทร์สีเลือด ----------
const KEY = "arc:bm";
let state = null;

function load() {
  if (!state) state = getWorld(KEY, { active: false, checkedDay: -1 });
  return state;
}

function store() {
  setWorld(KEY, state);
}

export function bloodMoonActive() {
  return load().active;
}

const isNight = () => {
  const t = world.getTimeOfDay();
  return t >= 13000 && t < 23000;
};

function overworldPlayers() {
  return world.getAllPlayers().filter((p) => p.dimension.id === "minecraft:overworld");
}

export function startBloodMoon() {
  load();
  state.active = true;
  store();
  for (const p of overworldPlayers()) {
    title(p, "§4§l☾ จันทร์สีเลือด ☾", "§cมอนสเตอร์แข็งแกร่งขึ้นและมาเป็นฝูง — XP x2!", 10, 80, 20);
    pushFog(p, "arc:blood_moon", "arc_bm");
    safe(() => p.playSound("mob.wither.spawn", { volume: 0.4, pitch: 0.5 }));
  }
  world.sendMessage("§4☾ §cจันทร์สีเลือดขึ้นแล้ว... ระวังตัวไว้!");
}

export function stopBloodMoon(announce = true) {
  load();
  state.active = false;
  store();
  for (const p of world.getAllPlayers()) popFog(p, "arc_bm");
  if (announce) world.sendMessage("§6☀ §eจันทร์สีเลือดผ่านพ้นไปแล้ว");
}

function spawnHorde(player) {
  if (player.getGameMode() === GameMode.Creative || player.getGameMode() === GameMode.Spectator) return;
  const dim = player.dimension;
  let near = 0;
  try {
    near = dim.getEntities({ location: player.location, maxDistance: 48, tags: ["arc_bm"] }).length;
  } catch {}
  if (near >= BLOOD_MOON_MAX_PER_PLAYER) return;
  const n = Math.min(BLOOD_MOON_MAX_PER_PLAYER - near, 1 + Math.floor(Math.random() * 3));
  for (let i = 0; i < n; i++) {
    const p = onCircle(player.location, rand(16, 26), rand(0, Math.PI * 2));
    const y = groundY(dim, { x: p.x, y: player.location.y + 12, z: p.z }, 30);
    const pos = { x: p.x, y, z: p.z };
    try {
      const b = dim.getBlock(V.floor(pos));
      if (!b || !b.isAir) continue;
      const m = dim.spawnEntity(pick(BLOOD_MOON_MOBS), pos);
      m.addTag("arc_bm");
      safe(() => m.addEffect("strength", 12000, { amplifier: 0, showParticles: false }));
      safe(() => m.addEffect("speed", 12000, { amplifier: 0, showParticles: false }));
      fx.smoke(dim, V.up(pos, 1), { red: 0.5, green: 0.02, blue: 0.05 }, 0.6, 8, 0.8);
    } catch {}
  }
}

function tick() {
  load();
  const ws = worldSettings();
  const night = isNight();
  if (!state.active && night && ws.bloodMoon) {
    const day = world.getDay();
    if (state.checkedDay !== day) {
      state.checkedDay = day;
      store();
      if ((day + 1) % BLOOD_MOON_EVERY === 0 || chance(BLOOD_MOON_RANDOM)) startBloodMoon();
    }
  } else if (state.active && (!night || !ws.bloodMoon)) {
    stopBloodMoon();
    return;
  }
  if (!state.active) return;
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== "minecraft:overworld") {
      popFog(p, "arc_bm");
      continue;
    }
    pushFog(p, "arc:blood_moon", "arc_bm");
    spawnHorde(p);
    if (chance(0.3)) fx.rise(p.dimension, p.location, COL.red, 6, 6, 0.6, 0.1);
    if (chance(0.15)) sound(p.dimension, "mob.wither.ambient", V.up(p.location, 20), 0.2, 0.4);
  }
}

export function initEvents() {
  system.runInterval(tick, 100);
  world.afterEvents.playerSpawn.subscribe(({ player }) => {
    if (!load().active) popFog(player, "arc_bm");
  });
}

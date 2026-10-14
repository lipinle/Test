import { world, system, ItemStack, EquipmentSlot, GameMode } from "@minecraft/server";

// ---------- เวกเตอร์ ----------
export const V = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  mul: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  len: (a) => Math.hypot(a.x, a.y, a.z),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  distXZ: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
  norm: (a) => {
    const l = Math.hypot(a.x, a.y, a.z);
    return l > 1e-6 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 1 };
  },
  lerp: (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }),
  floor: (a) => ({ x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z) }),
  center: (a) => ({ x: Math.floor(a.x) + 0.5, y: Math.floor(a.y), z: Math.floor(a.z) + 0.5 }),
  up: (a, h) => ({ x: a.x, y: a.y + h, z: a.z }),
};

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
export const fmt = (n) => Math.round(n).toLocaleString("en-US");
export const fmt1 = (n) => (Math.round(n * 10) / 10).toString();
export const roman = (n) => ["", "I", "II", "III", "IV", "V"][n] ?? String(n);

export function weightedPick(list, weightIndex) {
  const total = list.reduce((s, e) => s + e[weightIndex], 0);
  let r = Math.random() * total;
  for (const e of list) {
    r -= e[weightIndex];
    if (r <= 0) return e;
  }
  return list[list.length - 1];
}

/** มุมรอบวงกลม -> จุดบนวง */
export const onCircle = (c, r, ang, dy = 0) => ({ x: c.x + Math.cos(ang) * r, y: c.y + dy, z: c.z + Math.sin(ang) * r });

// ---------- entity ----------
export const alive = (e) => {
  try {
    return !!e && e.isValid;
  } catch {
    return false;
  }
};

export function safe(fn, label = "") {
  try {
    return fn();
  } catch (err) {
    if (label) console.warn(`[Arcane] ${label}: ${err}`);
    return undefined;
  }
}

export function health(e) {
  return e?.getComponent("minecraft:health");
}

export function hpPct(e) {
  const h = health(e);
  return h ? h.currentValue / Math.max(1, h.effectiveMax) : 1;
}

export function heal(e, amount) {
  const h = health(e);
  if (!h) return 0;
  const before = h.currentValue;
  h.setCurrentValue(Math.min(h.effectiveMax, before + amount));
  return h.currentValue - before;
}

export function getMainhand(player) {
  return player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
}

export function setMainhand(player, item) {
  player.getComponent("minecraft:equippable")?.setEquipment(EquipmentSlot.Mainhand, item);
}

export function isSurvivalLike(player) {
  const gm = player.getGameMode();
  return gm === GameMode.Survival || gm === GameMode.Adventure;
}

export function isCreative(player) {
  return player.getGameMode() === GameMode.Creative;
}

export function isOp(player) {
  try {
    return player.commandPermissionLevel >= 1 || player.playerPermissionLevel >= 2;
  } catch {
    return false;
  }
}

/**
 * ผู้เล่นที่ยังเล่นได้ (ไม่ใช่ spectator) ในรัศมี
 * @returns {import("@minecraft/server").Player[]}
 */
export function playersNear(dim, loc, radius, includeCreative = false) {
  const opts = { location: loc, maxDistance: radius };
  if (!includeCreative) opts.excludeGameModes = [GameMode.Creative, GameMode.Spectator];
  else opts.excludeGameModes = [GameMode.Spectator];
  try {
    return dim.getPlayers(opts);
  } catch {
    return [];
  }
}

export function eyeOf(e) {
  try {
    return e.getHeadLocation();
  } catch {
    return V.up(e.location, 1.6);
  }
}

export function centerOf(e) {
  try {
    return e.getAABB().center;
  } catch {
    return V.up(e.location, 0.9);
  }
}

/** ระยะจากจุดถึงกล่องชนของ entity (0 = อยู่ข้างใน) */
export function distToBox(p, e) {
  try {
    const { center: c, extent: x } = e.getAABB();
    const dx = Math.max(Math.abs(p.x - c.x) - x.x, 0);
    const dy = Math.max(Math.abs(p.y - c.y) - x.y, 0);
    const dz = Math.max(Math.abs(p.z - c.z) - x.z, 0);
    return Math.hypot(dx, dy, dz);
  } catch {
    return V.dist(p, V.up(e.location, 0.9));
  }
}

/** หาบล็อกพื้นด้านล่าง (ไม่เกิน depth บล็อก) คืนค่า y ของผิวพื้น */
export function groundY(dim, loc, depth = 24) {
  try {
    const hit = dim.getBlockFromRay({ x: loc.x, y: loc.y + 0.5, z: loc.z }, { x: 0, y: -1, z: 0 }, {
      maxDistance: depth, includeLiquidBlocks: true, includePassableBlocks: false,
    });
    if (hit) return hit.block.y + 1;
  } catch {}
  return Math.floor(loc.y);
}

// ---------- ไอเท็ม ----------
export function invOf(player) {
  return player.getComponent("minecraft:inventory")?.container;
}

export function countItem(player, typeId) {
  const inv = invOf(player);
  if (!inv) return 0;
  let n = 0;
  for (let i = 0; i < inv.size; i++) {
    const it = inv.getItem(i);
    if (it && it.typeId === typeId) n += it.amount;
  }
  return n;
}

/** ลบไอเท็มออกจากกระเป๋า (ถ้าไม่พอจะไม่ลบเลย) */
export function consumeItem(player, typeId, amount) {
  const inv = invOf(player);
  if (!inv || countItem(player, typeId) < amount) return false;
  let left = amount;
  for (let i = 0; i < inv.size && left > 0; i++) {
    const it = inv.getItem(i);
    if (!it || it.typeId !== typeId) continue;
    if (it.amount > left) {
      it.amount -= left;
      inv.setItem(i, it);
      left = 0;
    } else {
      left -= it.amount;
      inv.setItem(i, undefined);
    }
  }
  return true;
}

export function giveItem(player, typeId, amount = 1) {
  const inv = invOf(player);
  let left = amount;
  while (left > 0) {
    let stack;
    try {
      stack = new ItemStack(typeId, 1);
    } catch {
      return;
    }
    const n = Math.min(left, stack.maxAmount);
    stack.amount = n;
    left -= n;
    const rest = inv ? inv.addItem(stack) : stack;
    if (rest) safe(() => player.dimension.spawnItem(rest, player.location));
  }
}

export function giveStack(player, stack) {
  const inv = invOf(player);
  const rest = inv ? inv.addItem(stack) : stack;
  if (rest) safe(() => player.dimension.spawnItem(rest, player.location));
}

/** ชื่อไอเท็มแบบแปลภาษาได้ (ใช้ใน RawMessage) — ดึง key จากตัวเกมเอง */
const locCache = new Map();
export function itemName(typeId) {
  let key = locCache.get(typeId);
  if (!key) {
    key = safe(() => new ItemStack(typeId, 1).localizationKey) ?? `item.${typeId}.name`;
    locCache.set(typeId, key);
  }
  return { translate: key };
}

export function itemNameStr(typeId) {
  const short = typeId.split(":")[1] ?? typeId;
  return short.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- ข้อความ ----------
const lastMsg = new Map(); // player.id -> tick ที่ส่งข้อความ actionbar ล่าสุด (HUD จะหลบให้)

export function actionbar(player, text) {
  lastMsg.set(player.id, system.currentTick);
  safe(() => player.onScreenDisplay.setActionBar(text));
}

/** มีข้อความ actionbar อื่นแสดงอยู่ภายใน ticks ที่ผ่านมาไหม */
export function recentActionbar(player, ticks = 40) {
  return system.currentTick - (lastMsg.get(player.id) ?? -9999) < ticks;
}

/** เปิดฟอร์ม ถ้าผู้เล่นติดหน้าจออื่นอยู่ (UserBusy) จะลองใหม่อัตโนมัติ */
export function showForm(form, player, attempt = 0) {
  return form.show(player).then((res) => {
    if (res.canceled && res.cancelationReason === "UserBusy" && attempt < 20) {
      return system.waitTicks(5).then(() => showForm(form, player, attempt + 1));
    }
    return res;
  });
}

export function title(player, main, sub = "", fadeIn = 10, stay = 50, fadeOut = 15) {
  safe(() => player.onScreenDisplay.setTitle(main, { subtitle: sub, fadeInDuration: fadeIn, stayDuration: stay, fadeOutDuration: fadeOut }));
}

export function tell(player, msg) {
  safe(() => player.sendMessage(msg));
}

export function broadcast(msg) {
  safe(() => world.sendMessage(msg));
}

export function bar(frac, len, on = "§a", off = "§8", ch = "|") {
  const n = clamp(Math.round(frac * len), 0, len);
  return on + ch.repeat(n) + off + ch.repeat(len - n);
}

export const now = () => system.currentTick;

import { world, system, ItemStack, EnchantmentTypes, EquipmentSlot, GameMode, TimeOfDay, WeatherType } from "@minecraft/server";

// ===== ตั้งค่า =====
export const PREFIX = "§6[Easy Cheats]§r ";
export const MAX_HOMES = 20; // จำนวนบ้านสูงสุดต่อผู้เล่น
export const MAX_GIVE = 64 * 36; // เสกไอเท็มได้มากสุดครั้งละ (เต็มกระเป๋า)
export const MAX_HISTORY = 10; // จำคำสั่งที่พิมพ์ล่าสุดในเมนูกี่คำสั่ง
export const WAND_NAME = "§r§dไม้เมนูโกง";
export const WAND_LORE = "§7Easy Cheats: กดใช้เพื่อเปิดเมนู";
export const WAND_ITEM = "minecraft:stick";

// ไอเท็มชุดสำเร็จรูป /kit
export const KITS = {
  starter: [
    ["minecraft:stone_sword", 1],
    ["minecraft:stone_pickaxe", 1],
    ["minecraft:stone_axe", 1],
    ["minecraft:bread", 16],
    ["minecraft:torch", 32],
    ["minecraft:oak_log", 32],
    ["minecraft:bed", 1],
  ],
  tools: [
    ["minecraft:netherite_pickaxe", 1],
    ["minecraft:netherite_axe", 1],
    ["minecraft:netherite_shovel", 1],
    ["minecraft:netherite_hoe", 1],
    ["minecraft:shears", 1],
    ["minecraft:flint_and_steel", 1],
  ],
  armor: [
    ["minecraft:netherite_helmet", 1],
    ["minecraft:netherite_chestplate", 1],
    ["minecraft:netherite_leggings", 1],
    ["minecraft:netherite_boots", 1],
    ["minecraft:shield", 1],
  ],
  combat: [
    ["minecraft:netherite_sword", 1],
    ["minecraft:bow", 1],
    ["minecraft:arrow", 64],
    ["minecraft:enchanted_golden_apple", 8],
    ["minecraft:totem_of_undying", 2],
    ["minecraft:ender_pearl", 16],
  ],
  food: [
    ["minecraft:golden_carrot", 64],
    ["minecraft:cooked_beef", 64],
    ["minecraft:golden_apple", 16],
  ],
  builder: [
    ["minecraft:stone_bricks", 64],
    ["minecraft:oak_planks", 64],
    ["minecraft:glass", 64],
    ["minecraft:smooth_stone", 64],
    ["minecraft:quartz_block", 64],
    ["minecraft:torch", 64],
    ["minecraft:scaffolding", 64],
  ],
  flying: [
    ["minecraft:elytra", 1],
    ["minecraft:firework_rocket", 64],
  ],
};
export const KIT_ENCHANT = ["tools", "armor", "combat", "flying"]; // ชุดที่เอนชานต์สูงสุดให้อัตโนมัติ

// ลำดับเอนชานต์ที่เลือกก่อนเมื่อมีตัวที่ใช้ร่วมกันไม่ได้
const PREFERRED_ENCHANTS = [
  "mending",
  "unbreaking",
  "sharpness",
  "protection",
  "efficiency",
  "fortune",
  "power",
  "loyalty",
  "channeling",
  "multishot",
  "depth_strider",
  "density",
  "looting",
];
const CURSES = new Set(["binding", "vanishing"]);
// ===================

export const GAME_MODES = {
  c: GameMode.Creative,
  s: GameMode.Survival,
  a: GameMode.Adventure,
  sp: GameMode.Spectator,
};
export const GAME_MODE_NAMES = {
  [GameMode.Creative]: "สร้างสรรค์",
  [GameMode.Survival]: "เอาชีวิตรอด",
  [GameMode.Adventure]: "ผจญภัย",
  [GameMode.Spectator]: "ผู้ชม",
};
/** @type {Record<string, [number, string]>} */
export const TIMES = {
  day: [TimeOfDay.Day, "กลางวัน"],
  noon: [TimeOfDay.Noon, "เที่ยงวัน"],
  sunset: [TimeOfDay.Sunset, "พระอาทิตย์ตก"],
  night: [TimeOfDay.Night, "กลางคืน"],
  midnight: [TimeOfDay.Midnight, "เที่ยงคืน"],
};
/** @type {Record<string, [WeatherType, string]>} */
export const WEATHERS = {
  sun: [WeatherType.Clear, "ฟ้าใส"],
  rain: [WeatherType.Rain, "ฝนตก"],
  storm: [WeatherType.Thunder, "พายุฟ้าผ่า"],
};

// ---------- ข้อความ ----------
export function tell(target, message) {
  if (target?.isValid) target.sendMessage(PREFIX + message);
  else console.log(message);
}

export function fail(target, message) {
  tell(target, "§c" + message);
}

// ---------- เก็บข้อมูล (Dynamic Property) ----------
export function loadJSON(owner, key, fallback) {
  try {
    const raw = owner.getDynamicProperty(key);
    return typeof raw === "string" ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(owner, key, value) {
  owner.setDynamicProperty(key, JSON.stringify(value));
}

// ---------- บัฟถาวร (God / Night Vision / Speed ...) ----------
const BUFF_KEY = "ec:buffs";

export function getBuffs(player) {
  return loadJSON(player, BUFF_KEY, {});
}

export function setBuff(player, name, value) {
  const buffs = getBuffs(player);
  if (!value) delete buffs[name];
  else buffs[name] = value;
  saveJSON(player, BUFF_KEY, buffs);
  if (!value) clearBuffEffects(player, name);
  applyBuffs(player, buffs);
}

const BUFF_EFFECTS = {
  god: ["resistance", "fire_resistance", "water_breathing", "saturation"],
  nv: ["night_vision"],
  speed: ["speed"],
  haste: ["haste"],
  jump: ["jump_boost"],
};

function clearBuffEffects(player, name) {
  for (const effect of BUFF_EFFECTS[name] ?? []) player.removeEffect(effect);
}

function effect(player, id, duration, amplifier) {
  player.addEffect(id, duration, { amplifier, showParticles: false });
}

export function applyBuffs(player, buffs = getBuffs(player)) {
  if (buffs.god) {
    effect(player, "resistance", 60, 4); // ระดับ 5 = ไม่โดนดาเมจ
    effect(player, "fire_resistance", 60, 0);
    effect(player, "water_breathing", 60, 0);
    effect(player, "saturation", 60, 0);
    const health = player.getComponent("minecraft:health");
    if (health && health.currentValue < health.effectiveMax) health.resetToMaxValue();
  }
  if (buffs.nv) effect(player, "night_vision", 400, 0); // เกิน 10 วิ จอจะไม่กะพริบ
  if (buffs.speed) effect(player, "speed", 60, buffs.speed - 1);
  if (buffs.haste) effect(player, "haste", 60, buffs.haste - 1);
  if (buffs.jump) effect(player, "jump_boost", 60, buffs.jump - 1);
}

export function buffsText(buffs) {
  const parts = [];
  if (buffs.god) parts.push("อมตะ");
  if (buffs.nv) parts.push("มองในที่มืด");
  if (buffs.speed) parts.push(`วิ่งเร็ว ${buffs.speed}`);
  if (buffs.haste) parts.push(`ขุดไว ${buffs.haste}`);
  if (buffs.jump) parts.push(`กระโดดสูง ${buffs.jump}`);
  return parts.length ? parts.join(", ") : "ไม่มี";
}

// ---------- ผู้เล่น ----------
export function heal(player) {
  player.getComponent("minecraft:health")?.resetToMaxValue();
  feed(player);
  player.extinguishFire(false);
}

export function feed(player) {
  player.getComponent("minecraft:player.hunger")?.resetToMaxValue();
  player.getComponent("minecraft:player.saturation")?.resetToMaxValue();
}

export function clearEffects(player) {
  for (const e of player.getEffects()) player.removeEffect(e.typeId);
}

export function setGameMode(player, mode) {
  player.setGameMode(mode);
  tell(player, `โหมดเกม: §a${GAME_MODE_NAMES[mode]}`);
}

export function launch(player, power) {
  player.applyKnockback({ x: 0, z: 0 }, power);
  effect(player, "slow_falling", 200, 0);
}

// ---------- ไอเท็ม ----------
function inventory(player) {
  return player.getComponent("minecraft:inventory")?.container;
}

export function giveItem(player, typeId, amount) {
  const container = inventory(player);
  const max = new ItemStack(typeId, 1).maxAmount; // โยน error ถ้าไม่มีไอเท็มนี้
  let left = Math.max(1, Math.min(MAX_GIVE, Math.floor(amount)));
  const total = left;
  while (left > 0) {
    const stack = new ItemStack(typeId, Math.min(max, left));
    left -= stack.amount;
    const rest = container?.addItem(stack) ?? stack;
    if (rest) player.dimension.spawnItem(rest, player.location);
  }
  return total;
}

export function giveKit(player, name) {
  for (const [typeId, amount] of KITS[name]) {
    const stack = new ItemStack(typeId, amount);
    if (KIT_ENCHANT.includes(name)) maxEnchant(stack);
    const rest = inventory(player)?.addItem(stack) ?? stack;
    if (rest) player.dimension.spawnItem(rest, player.location);
  }
}

// อ่าน/เขียนไอเท็มในมือ ต้อง set กลับหลังแก้ไข
export function editHeld(player, edit) {
  const container = inventory(player);
  const slot = player.selectedSlotIndex;
  const item = container?.getItem(slot);
  if (!item) {
    fail(player, "ต้องถือไอเท็มไว้ในมือก่อน");
    return false;
  }
  const result = edit(item);
  if (result === false) return false;
  container.setItem(slot, result ?? item);
  return true;
}

export function repair(item) {
  const durability = item.getComponent("minecraft:durability");
  if (!durability || durability.damage === 0) return false;
  durability.damage = 0;
  return true;
}

export function repairAll(player) {
  let count = 0;
  const container = inventory(player);
  for (let i = 0; i < (container?.size ?? 0); i++) {
    const item = container.getItem(i);
    if (item && repair(item)) {
      container.setItem(i, item);
      count++;
    }
  }
  const equippable = player.getComponent("minecraft:equippable");
  for (const slot of [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand]) {
    const item = equippable?.getEquipment(slot);
    if (item && repair(item)) {
      equippable.setEquipment(slot, item);
      count++;
    }
  }
  return count;
}

let enchantOrder;
function allEnchantTypes() {
  if (!enchantOrder) {
    const all = EnchantmentTypes.getAll().filter((t) => !CURSES.has(t.id.replace("minecraft:", "")));
    const rank = (t) => {
      const i = PREFERRED_ENCHANTS.indexOf(t.id.replace("minecraft:", ""));
      return i < 0 ? PREFERRED_ENCHANTS.length : i;
    };
    enchantOrder = all.sort((a, b) => rank(a) - rank(b));
  }
  return enchantOrder;
}

// ใส่เอนชานต์ทุกตัวที่ไอเท็มนี้รับได้ ระดับสูงสุด คืนจำนวนที่ใส่
export function maxEnchant(item) {
  const enchantable = item.getComponent("minecraft:enchantable");
  if (!enchantable) return 0;
  let added = 0;
  for (const type of allEnchantTypes()) {
    const enchant = { type, level: type.maxLevel };
    try {
      const current = enchantable.getEnchantment(type);
      if (current) {
        if (current.level >= type.maxLevel) continue;
        enchantable.removeEnchantment(type);
      }
      if (enchantable.canAddEnchantment(enchant)) {
        enchantable.addEnchantment(enchant);
        added++;
      } else if (current) {
        enchantable.addEnchantment(current);
      }
    } catch {
      // เอนชานต์ที่ไอเท็มนี้ใช้ไม่ได้
    }
  }
  return added;
}

export function clearInventory(player) {
  inventory(player)?.clearAll();
}

export function giveWand(player) {
  const wand = new ItemStack(WAND_ITEM, 1);
  wand.nameTag = WAND_NAME;
  wand.setLore([WAND_LORE]);
  const rest = inventory(player)?.addItem(wand);
  if (rest) player.dimension.spawnItem(rest, player.location);
}

export function isWand(item) {
  return item?.typeId === WAND_ITEM && item.getLore().includes(WAND_LORE);
}

// ---------- วาร์ป ----------
const BACK_KEY = "ec:back";
const HOMES_KEY = "ec:homes";

function snapshot(entity) {
  const { x, y, z } = entity.location;
  return { d: entity.dimension.id, x, y, z };
}

export function rememberBack(player, location = snapshot(player)) {
  saveJSON(player, BACK_KEY, location);
}

export function teleport(player, location, dimension = player.dimension) {
  rememberBack(player);
  player.teleport(location, { dimension });
}

export function teleportSaved(player, saved) {
  teleport(player, { x: saved.x, y: saved.y, z: saved.z }, world.getDimension(saved.d));
}

export function back(player) {
  const saved = loadJSON(player, BACK_KEY, undefined);
  if (!saved) return false;
  teleportSaved(player, saved); // จุดปัจจุบันกลายเป็นจุด back ใหม่ กด back ซ้ำเพื่อสลับไปมาได้
  return true;
}

function isSolid(block) {
  return block && !block.isAir && !block.isLiquid;
}

// หาที่ยืนบนสุดของตำแหน่ง x,z (นรกหาใต้หลังคาหิน bedrock)
export function surfaceY(dimension, x, z) {
  if (dimension.id === "minecraft:nether") {
    for (let y = 125; y > 1; y--) {
      const block = dimension.getBlock({ x, y, z });
      if (!block) return undefined;
      if (isSolid(block) && block.above()?.isAir && block.above(2)?.isAir) return y + 1;
    }
    return undefined;
  }
  const top = dimension.getTopmostBlock({ x, z });
  return top ? top.y + 1 : undefined;
}

export function teleportToSurface(player, dimension, x, z) {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  rememberBack(player);
  const y = (() => {
    try {
      return dimension === player.dimension ? surfaceY(dimension, bx, bz) : undefined;
    } catch {
      return undefined;
    }
  })();
  if (y !== undefined) {
    player.teleport({ x: bx + 0.5, y, z: bz + 0.5 }, { dimension });
    return;
  }
  // chunk ยังไม่โหลด: ไปลอยไว้ก่อน แล้วค่อยหาพื้น
  effect(player, "slow_falling", 300, 0);
  effect(player, "resistance", 300, 4);
  player.teleport({ x: bx + 0.5, y: dimension.heightRange.max - 2, z: bz + 0.5 }, { dimension });
  let tries = 0;
  const id = system.runInterval(() => {
    tries++;
    try {
      if (!player.isValid) return system.clearRun(id);
      const found = surfaceY(dimension, bx, bz);
      if (found !== undefined) {
        player.teleport({ x: bx + 0.5, y: found, z: bz + 0.5 }, { dimension });
        player.removeEffect("resistance");
        system.clearRun(id);
      }
    } catch {
      // chunk ยังโหลดไม่เสร็จ
    }
    if (tries > 40) system.clearRun(id);
  }, 5);
}

export function teleportTop(player) {
  const { x, z } = player.location;
  teleportToSurface(player, player.dimension, x, z);
}

export function lookTarget(player, maxDistance = 256) {
  const entityHit = player.getEntitiesFromViewDirection({ maxDistance })[0];
  const blockHit = player.getBlockFromViewDirection({ maxDistance, includeLiquidBlocks: true });
  // เลือกสิ่งที่อยู่ใกล้กว่า ระหว่างตัวมอนกับบล็อก
  if (entityHit && (!blockHit || entityHit.distance < distanceTo(player, blockHit.block.location))) {
    return { location: entityHit.entity.location, entity: entityHit.entity };
  }
  if (blockHit) {
    const l = blockHit.block.location;
    return { location: { x: l.x + 0.5, y: l.y + 1, z: l.z + 0.5 }, block: blockHit.block };
  }
  return undefined;
}

function distanceTo(player, l) {
  const h = player.getHeadLocation();
  return Math.hypot(l.x + 0.5 - h.x, l.y + 0.5 - h.y, l.z + 0.5 - h.z);
}

export function teleportLook(player) {
  const hit = player.getBlockFromViewDirection({ maxDistance: 256, includeLiquidBlocks: true });
  if (!hit) return false;
  const { x, y, z } = hit.block.location;
  // ยืนบนบล็อกที่มอง ถ้าข้างบนไม่ว่างก็หาที่ว่างถัดขึ้นไป
  let top = y + 1;
  for (let i = 0; i < 64; i++) {
    const a = player.dimension.getBlock({ x, y: top, z });
    const b = player.dimension.getBlock({ x, y: top + 1, z });
    if (!isSolid(a) && !isSolid(b)) break;
    top++;
  }
  teleport(player, { x: x + 0.5, y: top, z: z + 0.5 });
  return true;
}

export function getHomes(player) {
  return loadJSON(player, HOMES_KEY, {});
}

export function setHome(player, name) {
  const homes = getHomes(player);
  if (!(name in homes) && Object.keys(homes).length >= MAX_HOMES) return false;
  homes[name] = snapshot(player);
  saveJSON(player, HOMES_KEY, homes);
  return true;
}

export function deleteHome(player, name) {
  const homes = getHomes(player);
  if (!(name in homes)) return false;
  delete homes[name];
  saveJSON(player, HOMES_KEY, homes);
  return true;
}

export function cleanName(name, fallback = "home") {
  const n = String(name ?? "").trim().toLowerCase().slice(0, 24);
  return n || fallback;
}

export function dimensionName(id) {
  return { "minecraft:overworld": "โลกปกติ", "minecraft:nether": "นรก", "minecraft:the_end": "End" }[id] ?? id;
}

// ---------- โลก ----------
export function butcher(player, radius) {
  let count = 0;
  for (const entity of player.dimension.getEntities({ location: player.location, maxDistance: radius, families: ["monster"] })) {
    if (entity.kill()) count++;
  }
  return count;
}

export function smite(dimension, location) {
  dimension.spawnEntity("minecraft:lightning_bolt", location);
}

export function explode(player, location, power) {
  player.dimension.createExplosion(location, power, { breaksBlocks: true, causesFire: false, source: player });
}

// ---------- มาโคร / รันหลายคำสั่ง ----------
const MACROS_KEY = "ec:macros";
const HISTORY_KEY = "ec:history";

export function getMacros() {
  return loadJSON(world, MACROS_KEY, {});
}

export function setMacro(name, commands) {
  const macros = getMacros();
  if (commands === undefined) delete macros[name];
  else macros[name] = commands;
  saveJSON(world, MACROS_KEY, macros);
}

export function getHistory(player) {
  return loadJSON(player, HISTORY_KEY, []);
}

export function pushHistory(player, text) {
  const history = getHistory(player).filter((h) => h !== text);
  history.unshift(text);
  saveJSON(player, HISTORY_KEY, history.slice(0, MAX_HISTORY));
}

export function splitCommands(text) {
  return String(text)
    .split(/[;\n]/)
    .map((c) => c.trim().replace(/^\/+/, ""))
    .filter((c) => c.length > 0);
}

// รันหลายคำสั่งในชื่อผู้เล่น (คั่นด้วย ;) คืน [สำเร็จ, ทั้งหมด]
export function runCommands(player, text) {
  const commands = splitCommands(text);
  let ok = 0;
  for (const command of commands) {
    if (/^(cheat:)?macro\b/i.test(command)) {
      fail(player, `ข้าม "${command}" (ห้ามเรียกมาโครซ้อนมาโคร)`);
      continue;
    }
    try {
      const result = player.runCommand(command);
      if (result.successCount > 0) ok++;
      else fail(player, `/${command} ไม่ได้ผล`);
    } catch (e) {
      fail(player, `/${command} ผิดพลาด: ${e?.message ?? e}`);
    }
  }
  return [ok, commands.length];
}

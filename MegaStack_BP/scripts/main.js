import { world, system, GameMode } from "@minecraft/server";

// ===== ตั้งค่า =====
const MAX_STACK = 10_000_000; // จำนวนสูงสุดต่อ 1 กอง
const MERGE_RADIUS = 9; // กองเก่าที่อยู่ในระยะนี้จะวาปมารวมกับกองใหม่ (บล็อก)
const SCAN_INTERVAL = 5; // สแกนไอเท็มบนพื้นทุกกี่ tick (20 tick = 1 วินาที)
const PICKUP_RADIUS = 1.75; // ผู้เล่นอยู่ใกล้กองเท่านี้จะเก็บส่วนที่เกิน 1 สแต็กได้
const PICKUP_DELAY = 20; // หลังกองเพิ่งรวมกัน รอกี่ tick ก่อนให้เก็บ (กันเก็บของที่เพิ่งโยนทิ้งคืนทันที)
const MERGE_UNSTACKABLES = true; // รวมเครื่องมือ/เกราะ/อาวุธที่เหมือนกันทุกอย่าง (ความทนทาน, เอนชานต์, ชื่อ) ด้วย
const WARP_EFFECT = true; // แสดงเส้นแสงตอนกองเก่าวาปไปหากองใหม่
const MAX_EFFECTS_PER_SCAN = 8; // จำกัดจำนวนเอฟเฟกต์ต่อรอบ กันแลค
const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];

// ห้ามรวม: ของที่มีของข้างในหรือข้อมูลที่สคริปต์อ่านไม่ได้ (รวมแล้วข้อมูลข้างในจะหาย)
const NEVER_MERGE_UNSTACKABLE = ["shulker_box", "bundle", "filled_map", "written_book", "writable_book", "potion", "banner", "firework"];
// ===================

const P_COUNT = "ms:count"; // จำนวนทั้งหมดในกอง
const P_SEEN = "ms:seen"; // จำนวนจริงในตัว entity ตอนสแกนล่าสุด (ใช้ตรวจว่ามีคนเก็บไปบางส่วน)
const P_BORN = "ms:born"; // เวลาที่เกิดกอง ใช้หาว่ากองไหนใหม่กว่า

const removing = new Map(); // entity.id -> tick: entity ที่สคริปต์ลบเอง ไม่ต้องคืนของ
const mergedAt = new Map(); // entity.id -> tick ที่เพิ่งมีกองอื่นวาปมารวม

// ---------------------------------------------------------------------------
// ข้อมูลไอเท็ม
// ---------------------------------------------------------------------------

function readStack(entity) {
  try {
    return entity.getComponent("minecraft:item")?.itemStack;
  } catch {
    return undefined;
  }
}

function itemName(item) {
  if (item.nameTag) return item.nameTag;
  return item.typeId
    .split(":")
    .pop()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function formatNumber(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function makeLabel(item, count) {
  const color = count >= 1_000_000 ? "§6" : count >= 10_000 ? "§d" : count > item.maxAmount ? "§a" : "§e";
  return `§l§f${itemName(item)}\n§r${color}x${formatNumber(count)}`;
}

function enchantKey(item) {
  try {
    const list = item.getComponent("minecraft:enchantable")?.getEnchantments() ?? [];
    return list
      .map((e) => `${e.type.id}:${e.level}`)
      .sort()
      .join(",");
  } catch {
    return "";
  }
}

function sameItem(a, b) {
  if (a.typeId !== b.typeId) return false;
  if (a.maxAmount > 1) {
    // เกมเทียบชนิด, ชื่อ, lore, ข้อมูลอื่น ๆ ให้เอง
    try {
      return a.isStackableWith(b);
    } catch {
      return false;
    }
  }
  if (!MERGE_UNSTACKABLES) return false;
  if (NEVER_MERGE_UNSTACKABLE.some((k) => a.typeId.includes(k))) return false;
  // รวมเฉพาะของที่มีความทนทาน (เครื่องมือ/อาวุธ/เกราะ) และเหมือนกันทุกอย่าง
  const da = a.getComponent("minecraft:durability");
  const db = b.getComponent("minecraft:durability");
  if (!da || !db || da.damage !== db.damage) return false;
  if ((a.nameTag ?? "") !== (b.nameTag ?? "")) return false;
  if (a.getLore().join("\n") !== b.getLore().join("\n")) return false;
  if (enchantKey(a) !== enchantKey(b)) return false;
  try {
    if (JSON.stringify(a.getComponent("minecraft:dyeable")?.color) !== JSON.stringify(b.getComponent("minecraft:dyeable")?.color)) return false;
  } catch {}
  // ของที่ addon อื่นฝังข้อมูลไว้ ไม่รวม
  try {
    if (a.getDynamicPropertyIds().length || b.getDynamicPropertyIds().length) return false;
  } catch {}
  return true;
}

// ---------------------------------------------------------------------------
// เอฟเฟกต์วาป
// ---------------------------------------------------------------------------

function warpEffect(dim, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const steps = Math.max(2, Math.ceil(Math.hypot(dx, dy, dz)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = { x: from.x + dx * t, y: from.y + dy * t + 0.3, z: from.z + dz * t };
    // ไล่ทีละช่วงให้ดูเหมือนพุ่งไปหากองใหม่
    system.runTimeout(() => {
      try {
        dim.spawnParticle("minecraft:endrod", p);
      } catch {}
    }, Math.floor(i / 2));
  }
  try {
    dim.playSound("mob.endermen.portal", to, { volume: 0.25, pitch: 1.6 });
  } catch {}
}

// ---------------------------------------------------------------------------
// จัดการกอง
// ---------------------------------------------------------------------------

function removeQuietly(entity) {
  removing.set(entity.id, system.currentTick);
  try {
    entity.remove();
  } catch {
    removing.delete(entity.id);
  }
}

function absorb(master, other, fx) {
  const room = MAX_STACK - master.count;
  if (room <= 0) return;
  if (other.count <= room) {
    master.count += other.count;
    other.gone = true;
    if (WARP_EFFECT && fx.left-- > 0) warpEffect(master.entity.dimension, other.loc, master.loc);
    removeQuietly(other.entity);
  } else {
    // กองใหม่เกือบเต็ม: ย้ายมาได้เฉพาะส่วนเกินของกองเก่า (ของจริงในตัว entity ย้ายไม่ได้)
    const moved = Math.min(room, other.count - other.real);
    if (moved <= 0) return;
    master.count += moved;
    other.count -= moved;
  }
  mergedAt.set(master.entity.id, system.currentTick);
}

// ให้ผู้เล่นที่ยืนใกล้ ๆ ได้ส่วนที่เกินจากของจริงในตัว entity (ของจริงเกมเก็บให้เองตามปกติ)
function givePickup(dim, s) {
  const last = mergedAt.get(s.entity.id);
  if (last !== undefined && system.currentTick - last < PICKUP_DELAY) return;
  const players = dim.getPlayers({ location: s.loc, maxDistance: PICKUP_RADIUS, excludeGameModes: [GameMode.Spectator] });
  for (const player of players) {
    if (s.count <= s.real) return;
    if (!player.isValid || (player.getComponent("minecraft:health")?.currentValue ?? 1) <= 0) continue;
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) continue;
    let given = 0;
    try {
      while (s.count - given > s.real) {
        const n = Math.min(s.count - given - s.real, s.item.maxAmount);
        const give = s.item.clone();
        give.amount = n;
        const left = inv.addItem(give);
        given += n - (left?.amount ?? 0);
        if (left) break; // กระเป๋าเต็ม
      }
    } catch {}
    if (given > 0) {
      s.count -= given;
      try {
        dim.playSound("random.pop", player.location, { volume: 0.4, pitch: 1.4 + Math.random() * 0.4 });
      } catch {}
    }
  }
}

function save(s) {
  const e = s.entity;
  if (e.getDynamicProperty(P_COUNT) !== s.count) e.setDynamicProperty(P_COUNT, s.count);
  if (e.getDynamicProperty(P_SEEN) !== s.real) e.setDynamicProperty(P_SEEN, s.real);
  if (e.getDynamicProperty(P_BORN) !== s.born) e.setDynamicProperty(P_BORN, s.born);
  const label = makeLabel(s.item, s.count);
  if (e.nameTag !== label) e.nameTag = label;
}

function scanDimension(dim, now) {
  let entities;
  try {
    entities = dim.getEntities({ type: "minecraft:item" });
  } catch {
    return;
  }

  const stacks = [];
  for (const entity of entities) {
    if (!entity.isValid || removing.has(entity.id)) continue;
    const item = readStack(entity);
    if (!item) continue;
    const real = item.amount;
    let count = entity.getDynamicProperty(P_COUNT);
    const seen = entity.getDynamicProperty(P_SEEN);
    let born = entity.getDynamicProperty(P_BORN);
    if (typeof count !== "number") count = real;
    // ของจริงในตัวลด = มีคน/ฮอปเปอร์เก็บไปบางส่วน, เพิ่ม = เกมรวมไอเท็มชิ้นอื่นเข้ามาเอง
    else if (typeof seen === "number") count += real - seen;
    if (count < real) count = real;
    if (typeof born !== "number") born = now;
    stacks.push({ entity, item, real, count, born, loc: entity.location, gone: false });
  }
  if (stacks.length === 0) return;

  // กองใหม่สุดก่อน: กองเก่าในระยะจะวาปมารวมกับกองใหม่
  stacks.sort((a, b) => b.born - a.born);
  const r2 = MERGE_RADIUS * MERGE_RADIUS;
  const fx = { left: MAX_EFFECTS_PER_SCAN };
  for (let i = 0; i < stacks.length; i++) {
    const master = stacks[i];
    if (master.gone || master.count >= MAX_STACK) continue;
    for (let j = i + 1; j < stacks.length; j++) {
      const other = stacks[j];
      if (other.gone) continue;
      const dx = other.loc.x - master.loc.x;
      const dy = other.loc.y - master.loc.y;
      const dz = other.loc.z - master.loc.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      if (!sameItem(master.item, other.item)) continue;
      absorb(master, other, fx);
      if (master.count >= MAX_STACK) break;
    }
  }

  for (const s of stacks) {
    if (s.gone || !s.entity.isValid) continue;
    try {
      if (s.count > s.real) givePickup(dim, s);
      save(s);
    } catch {}
  }
}

let dimensions;
system.runInterval(() => {
  dimensions ??= DIMENSIONS.map((id) => world.getDimension(id));
  const now = world.getAbsoluteTime();
  for (const dim of dimensions) scanDimension(dim, now);

  const tick = system.currentTick;
  for (const [id, t] of removing) if (tick - t > 100) removing.delete(id);
  for (const [id, t] of mergedAt) if (tick - t > PICKUP_DELAY) mergedAt.delete(id);
}, SCAN_INTERVAL);

// ---------------------------------------------------------------------------
// ตัว entity ของกองหายไป (ถูกเก็บ / ถูกรวมโดยเกม / ลงฮอปเปอร์ / ไหม้ ฯลฯ)
// ---------------------------------------------------------------------------

const HAZARDS = new Set(["minecraft:lava", "minecraft:flowing_lava", "minecraft:fire", "minecraft:soul_fire", "minecraft:cactus"]);

function isHazard(block) {
  return HAZARDS.has(block?.typeId);
}

// มีอะไรมาเอาไอเท็มไปหรือไม่ (ผู้เล่น, มอบ, ไอเท็มชิ้นอื่น, ฮอปเปอร์)
// ถ้าไม่มีอะไรอยู่ใกล้เลย = หมดเวลา/ถูก /kill/ chunk ถูก unload → ไม่คืนของ เหมือนเกมปกติ และกันของซ้ำ
function somethingTookIt(dim, loc) {
  if (dim.getEntities({ location: loc, maxDistance: 2.5 }).length > 0) return true;
  for (const dy of [0, -1]) {
    try {
      if (dim.getBlock({ x: loc.x, y: loc.y + dy, z: loc.z })?.typeId === "minecraft:hopper") return true;
    } catch {}
  }
  return false;
}

function respawnRemainder(dim, loc, template, remainder, born) {
  let block;
  try {
    block = dim.getBlock(loc);
  } catch {}
  if (!block || isHazard(block)) return;
  if (loc.y < dim.heightRange.min) return;
  if (!somethingTookIt(dim, loc)) return;

  const stack = template.clone();
  stack.amount = Math.min(remainder, stack.maxAmount);
  const entity = dim.spawnItem(stack, loc);
  try {
    entity.clearVelocity();
  } catch {}
  entity.setDynamicProperty(P_COUNT, remainder);
  entity.setDynamicProperty(P_SEEN, stack.amount);
  entity.setDynamicProperty(P_BORN, typeof born === "number" ? born : world.getAbsoluteTime());
  entity.nameTag = makeLabel(stack, remainder);
}

world.beforeEvents.entityRemove.subscribe((ev) => {
  const entity = ev.removedEntity;
  if (entity.typeId !== "minecraft:item") return;
  if (removing.delete(entity.id)) return;

  const count = entity.getDynamicProperty(P_COUNT);
  const seen = entity.getDynamicProperty(P_SEEN);
  if (typeof count !== "number" || typeof seen !== "number") return;
  // ของจริงในตัวถูกเอาไปหมดแล้ว ที่เหลือคือส่วนเกินที่ต้องวางกลับ
  const remainder = count - seen;
  if (remainder <= 0) return;

  const template = readStack(entity)?.clone();
  if (!template) return;
  const dim = entity.dimension;
  const loc = { ...entity.location };
  const born = entity.getDynamicProperty(P_BORN);
  system.run(() => {
    try {
      respawnRemainder(dim, loc, template, remainder, born);
    } catch {}
  });
});

// ---------------------------------------------------------------------------
// คำสั่ง (ต้องเปิดโกง)
//   /scriptevent ms:clear  ลบไอเท็มบนพื้นทั้งหมด (รวมกองใหญ่) ใช้แทน /kill @e[type=item]
//   /scriptevent ms:info   ดูจำนวนกองและจำนวนไอเท็มทั้งหมดบนพื้น
// ---------------------------------------------------------------------------

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "ms:clear" && ev.id !== "ms:info") return;
  dimensions ??= DIMENSIONS.map((id) => world.getDimension(id));
  let piles = 0;
  let total = 0;
  for (const dim of dimensions) {
    for (const entity of dim.getEntities({ type: "minecraft:item" })) {
      const count = entity.getDynamicProperty(P_COUNT);
      piles++;
      total += typeof count === "number" ? count : (readStack(entity)?.amount ?? 0);
      if (ev.id === "ms:clear") removeQuietly(entity);
    }
  }
  const msg =
    ev.id === "ms:clear"
      ? `§a[Mega Stack] ลบไอเท็มบนพื้น ${formatNumber(piles)} กอง รวม ${formatNumber(total)} ชิ้น`
      : `§e[Mega Stack] ไอเท็มบนพื้น ${formatNumber(piles)} กอง รวม ${formatNumber(total)} ชิ้น (โหลดอยู่เท่านั้น)`;
  if (ev.sourceEntity?.typeId === "minecraft:player") ev.sourceEntity.sendMessage(msg);
  else world.sendMessage(msg);
});

import { world, system, BlockTypes, ItemTypes, StructureSaveMode } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { typeIdToDataId, typeIdToID } from "./chest_ui/typeIds.js";

// ===== ตั้งค่า =====
// ถุงแต่ละระดับ: จำนวนช่องเก็บของทั้งหมด (หน้าละ 45 ช่อง แถวล่างสุดเป็นปุ่ม)
const BAGS = {
  "bt:bundle_leather": { tier: 1, slots: 9, name: "ถุงหนัง" },
  "bt:bundle_iron": { tier: 2, slots: 27, name: "ถุงเหล็ก" },
  "bt:bundle_gold": { tier: 3, slots: 54, name: "ถุงทอง" },
  "bt:bundle_diamond": { tier: 4, slots: 108, name: "ถุงเพชร" },
  "bt:bundle_netherite": { tier: 5, slots: 216, name: "ถุงเนเทอไรท์" },
};
const JOIN_DELAY = 60; // หลังเข้าโลก รอกี่ tick ก่อนเปิดถุงได้ (ให้ chunk โหลดเสร็จก่อน)
const UPGRADE_WINDOW = 6000; // ถุงที่หายจากกระเป๋า (เอาไปวางในโต๊ะคราฟ) จำไว้กี่ tick เพื่อย้ายของไปถุงขั้นถัดไป
const SWEEP_INTERVAL = 100; // ตรวจหาถุงที่ค้างอยู่ในโลก (เช่น ปิดเกมตอนเปิดถุง) แล้วบันทึกทุกกี่ tick
const ALLOW_BAG_IN_BAG = false; // ใส่ถุงไว้ในถุงได้ไหม
// ===================

const PAGE = "bt:bag_page"; // entity เก็บของ 1 หน้า (45 ช่อง) อยู่ใต้เพดานโลกตอนเปิดถุง ปิดถุงแล้วเก็บเป็น structure
const OLD_UI = "bt:bag_ui"; // entity หน้าต่างของเวอร์ชัน 1.0.0 (ไม่ใช้แล้ว เหลือไว้เก็บกวาดของที่ค้างในโลก)
const PER_PAGE = 45;
const SLOT_PREV = 45;
const SLOT_INFO = 49;
const SLOT_NEXT = 53;
const INV_START = 54; // ปุ่มลำดับที่ 54 เป็นต้นไป = ช่องกระเป๋าผู้เล่น 0-35
const CHEST_54 = "§c§h§e§s§t§5§4§r"; // ธงบอก Chest UI (RP/ui) ให้วาดฟอร์มเป็นกล่องใหญ่ 54 ช่อง
const ICON = {
  prev: "textures/items/bt_btn_prev",
  next: "textures/items/bt_btn_next",
  info: "textures/items/bt_btn_info",
  fill: "textures/items/bt_btn_fill",
  lock: "textures/items/bt_btn_lock",
  unknown: "textures/items/bt_unknown",
};
const P_ID = "bt:id"; // dynamic property บนไอเท็มถุง: รหัสถุง (ใช้ตั้งชื่อ structure ที่เก็บของ)
const TAG_ID = "bt_id:";
const TAG_PAGE = "bt_pg:";
const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
// แตะบล็อกพวกนี้ตอนถือถุง = ใช้บล็อกตามปกติ (ไม่เปิดถุง)
const INTERACTIVE =
  /chest|barrel|door|gate|button|lever|crafting|furnace|smoker|anvil|table|shulker|hopper|dispenser|dropper|bed|bell|lectern|loom|stonecutter|grindstone|cartography|smithing|brewing|beacon|enchanting|composter|cauldron|jukebox|noteblock|repeater|comparator|daylight|respawn_anchor|lodestone|campfire|sign|frame|cake|candle|beehive|bee_nest|decorated_pot|crafter|vault|command_block|structure|jigsaw/;

let tick = 0;
const sessions = new Map(); // player.id -> ถุงที่กำลังเปิดอยู่
const joinedAt = new Map(); // player.id -> tick ที่เข้าโลก
const memory = new Map(); // player.id -> { present: Map<id, tier>, vanished: [{ id, tier, at }] }
const lastOpen = new Map(); // player.id -> tick ที่กดเปิดล่าสุด (กันเปิดซ้ำ)

// ---------------------------------------------------------------------------
// เครื่องมือ
// ---------------------------------------------------------------------------

const isBag = (item) => !!item && item.typeId in BAGS;
const container = (entity) => entity?.getComponent("minecraft:inventory")?.container;
const playerInv = (player) => player.getComponent("minecraft:inventory")?.container;
const structId = (id) => `bt:bag_${id}`;
const floorVec = (v) => ({ x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) });
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const alive = (player) => player.isValid && (player.getComponent("minecraft:health")?.currentValue ?? 1) > 0;

function tagValue(entity, prefix) {
  for (const t of entity.getTags()) if (t.startsWith(prefix)) return t.slice(prefix.length);
  return undefined;
}

function pageOf(entity) {
  const n = parseInt(tagValue(entity, TAG_PAGE) ?? "", 10);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

function newId() {
  return Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
}

function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function bagId(item) {
  const id = item.getDynamicProperty(P_ID);
  return typeof id === "string" ? id : undefined;
}

function cursorItem(player) {
  try {
    return player.getComponent("minecraft:cursor_inventory")?.item;
  } catch {
    return undefined;
  }
}

// ทำลาย entity ของถุงโดยไม่ให้ของในตัวหล่นออกมา
function discard(entity) {
  if (!entity?.isValid) return;
  try {
    container(entity)?.clearAll();
  } catch {}
  entity.remove();
}

function hide(entity) {
  try {
    entity.addEffect("invisibility", 20000000, { amplifier: 0, showParticles: false });
  } catch {}
}

function sound(player, id, pitch = 1) {
  try {
    player.playSound(id, { pitch, volume: 0.6 });
  } catch {}
}

// ย้ายของทั้งกองจาก from[slot] ไปยัง to (เฉพาะช่องใน slots): เติมกองที่ซ้อนได้ก่อน แล้วลงช่องว่าง
// ช่องว่างใช้ moveItem ข้อมูลไอเท็มจึงตามไปครบ (เอนชานท์ ชื่อ ของในกล่องชัลเกอร์) คืนจำนวนที่ย้ายไม่ได้
function moveStack(from, slot, to, slots) {
  const item = from.getItem(slot);
  if (!item) return 0;
  let left = item.amount;
  if (item.maxAmount > 1) {
    for (const j of slots) {
      const e = to.getItem(j);
      if (!e || e.amount >= e.maxAmount || !e.isStackableWith(item)) continue;
      const add = Math.min(left, e.maxAmount - e.amount);
      e.amount += add;
      to.setItem(j, e);
      left -= add;
      if (!left) break;
    }
  }
  if (left) {
    const empty = slots.find((j) => !to.getItem(j));
    if (empty !== undefined) {
      if (left === item.amount) {
        from.moveItem(slot, empty, to);
        return 0;
      }
      item.amount = left;
      to.setItem(empty, item);
      left = 0;
    }
  }
  if (!left) from.setItem(slot);
  else if (left !== item.amount) {
    item.amount = left;
    from.setItem(slot, item);
  }
  return left;
}

// ---------------------------------------------------------------------------
// รหัสถุง + อัปเกรด (ของในถุงเดิมย้ายไปถุงขั้นถัดไปเอง)
// ---------------------------------------------------------------------------

function bagLore(typeId) {
  return [`§r§7ช่องเก็บของ: §f${BAGS[typeId].slots} ช่อง`, "§r§8ถือแล้วกดใช้ (แตะหน้าจอ / คลิกขวา) เพื่อเปิด"];
}

function getMemory(player) {
  let m = memory.get(player.id);
  if (!m) memory.set(player.id, (m = { present: new Map(), vanished: [] }));
  return m;
}

// ถุงใหม่ที่ยังไม่มีรหัส: ถ้าเพิ่งมีถุงระดับต่ำกว่า 1 ขั้นหายไปจากกระเป๋า (เอาไปคราฟอัปเกรด) ใช้รหัสเดิม = ของเดิมตามมาด้วย
function ensureId(player, inv, slot) {
  const item = inv.getItem(slot);
  if (!isBag(item)) return undefined;
  const lore = bagLore(item.typeId);
  let id = bagId(item);
  if (id) {
    if (item.getLore()[0] !== lore[0] || item.getLore()[1] !== lore[1]) {
      item.setLore(lore); // ถุงที่อัปเกรดด้วยโต๊ะตีเหล็กจะติดรหัสเดิมมา แค่แก้คำอธิบาย
      inv.setItem(slot, item);
    }
    return id;
  }
  const tier = BAGS[item.typeId].tier;
  const m = getMemory(player);
  let inherited = false;
  for (let k = m.vanished.length - 1; k >= 0; k--) {
    const v = m.vanished[k];
    if (v.tier === tier - 1 && ![...sessions.values()].some((s) => s.bagId === v.id)) {
      id = v.id;
      m.vanished.splice(k, 1);
      inherited = true;
      break;
    }
  }
  id ??= newId();
  item.setDynamicProperty(P_ID, id);
  item.setLore(lore);
  inv.setItem(slot, item);
  m.present.set(id, tier);
  if (inherited) player.sendMessage(`§a[ถุง] อัปเกรดเป็น${BAGS[item.typeId].name}แล้ว ของเดิมย้ายมาครบ (${BAGS[item.typeId].slots} ช่อง)`);
  return id;
}

function scanBags(player, inv) {
  const m = getMemory(player);
  const now = new Map();
  const fix = [];
  for (let i = 0; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (!isBag(item)) continue;
    const id = bagId(item);
    if (id) now.set(id, BAGS[item.typeId].tier);
    if (!id || item.getLore()[0] !== bagLore(item.typeId)[0]) fix.push(i);
  }
  const cur = cursorItem(player);
  if (isBag(cur) && bagId(cur)) now.set(bagId(cur), BAGS[cur.typeId].tier);
  for (const [id, tier] of m.present) if (!now.has(id)) m.vanished.push({ id, tier, at: tick });
  m.vanished = m.vanished.filter((v) => !now.has(v.id) && tick - v.at < UPGRADE_WINDOW);
  m.present = now;
  for (const slot of fix) ensureId(player, inv, slot);
}

// ---------------------------------------------------------------------------
// หน้าต่างถุง (Chest UI): ช่อง 0-44 ของในถุง, 45-53 ปุ่มกระจกสี, 54-89 กระเป๋าผู้เล่น
// ---------------------------------------------------------------------------

const pageCap = (s, n = s.page) => Math.max(0, Math.min(PER_PAGE, s.slots - n * PER_PAGE));

// ไอเท็มเสริมจาก addon ทุกตัวในโลกทำให้เลข id ไอเท็มเกมเดิม (>= 850) เลื่อนไป ต้องนับเพื่อให้ไอคอนตรง
let customItemCount;
function customItems() {
  if (customItemCount === undefined) {
    try {
      const blocks = new Set(BlockTypes.getAll().map((b) => b.id));
      customItemCount = ItemTypes.getAll().filter((t) => !t.id.startsWith("minecraft:") && !blocks.has(t.id)).length;
    } catch {
      customItemCount = 0;
    }
  }
  return customItemCount;
}

function isEnchanted(item) {
  try {
    return (item.getComponent("minecraft:enchantable")?.getEnchantments().length ?? 0) > 0;
  } catch {
    return false;
  }
}

function iconOf(item) {
  if (isBag(item)) return `textures/items/${item.typeId.replace(":", "_")}`;
  const id = typeIdToDataId.get(item.typeId) ?? typeIdToID.get(item.typeId);
  if (id === undefined) return ICON.unknown;
  return String((id + (id < 850 ? 0 : customItems())) * 65536 + (isEnchanted(item) ? 32768 : 0));
}

const pad2 = (n) => String(Math.min(Math.max(Math.round(n), 0), 99)).padStart(2, "0");
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

// ข้อความปุ่มตามรูปแบบของ Chest UI: stack#จำนวน dur#ความทนทาน แล้วตามด้วยชื่อ/คำอธิบาย
function slotText(name, lore, amount = 1, dur = 0) {
  const raw = [{ text: `stack#${pad2(Math.max(amount, 1))}dur#${pad2(dur)}§r` }];
  if (typeof name === "string") raw.push({ text: `${name}§r` });
  else raw.push(name, { text: "§r" });
  for (const line of lore) raw.push({ text: `\n${line}` });
  return { rawtext: raw };
}

function itemText(item, hint) {
  const name = item.nameTag ? `§o${item.nameTag}` : { translate: item.localizationKey };
  const lore = [];
  try {
    for (const e of item.getComponent("minecraft:enchantable")?.getEnchantments() ?? []) {
      const title = e.type.id.replace(/^minecraft:/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      lore.push(`§7${title} ${ROMAN[e.level] ?? e.level}`);
    }
  } catch {}
  lore.push(...item.getLore());
  if (hint) lore.push(hint);
  let dur = 0;
  const d = item.getComponent("minecraft:durability");
  if (d && d.damage > 0) dur = Math.max(1, ((d.maxDurability - d.damage) / d.maxDurability) * 99);
  return slotText(name, lore, item.amount, dur);
}

function rowButton(s, slot) {
  if (slot === SLOT_PREV && s.page > 0) return { text: slotText("§c§l◀ หน้าก่อนหน้า", [`§7ไปหน้า ${s.page}/${s.total}`]), icon: ICON.prev };
  if (slot === SLOT_NEXT && s.page < s.total - 1)
    return { text: slotText("§a§lหน้าถัดไป ▶", [`§7ไปหน้า ${s.page + 2}/${s.total}`]), icon: ICON.next };
  if (slot === SLOT_INFO)
    return {
      text: slotText(`§e§lหน้า ${s.page + 1}/${s.total}`, [
        `§7${BAGS[s.typeId].name}: §f${s.slots} ช่อง`,
        `§7หน้านี้: §f${pageCap(s)} ช่อง`,
        "§8แตะของในถุง = หยิบออก",
        "§8แตะของในกระเป๋า = ใส่ถุง",
      ]),
      icon: ICON.info,
    };
  return { text: slotText("§8 ", []), icon: ICON.fill };
}

function buildForm(s, inv) {
  const info = BAGS[s.typeId];
  const form = new ActionFormData().title({ rawtext: [{ text: `${CHEST_54}§8${info.name} §7(${s.page + 1}/${s.total})` }] });
  const pg = container(s.pages[s.page]);
  const cap = pageCap(s);
  const lockLore = info.tier >= 5 ? "§8ถุงความจุสูงสุดแล้ว" : "§8อัปเกรดถุงเพื่อเพิ่มช่อง";
  for (let i = 0; i < PER_PAGE; i++) {
    const item = i < cap ? pg.getItem(i) : undefined;
    if (i >= cap) form.button(slotText("§7ช่องล็อก", [lockLore]), ICON.lock);
    else if (item) form.button(itemText(item, "§8แตะเพื่อหยิบออก"), iconOf(item));
    else form.button("");
  }
  for (let slot = PER_PAGE; slot < INV_START; slot++) {
    const b = rowButton(s, slot);
    form.button(b.text, b.icon);
  }
  for (let i = 0; i < 36; i++) {
    const item = i < inv.size ? inv.getItem(i) : undefined;
    if (!item) form.button("");
    else form.button(itemText(item, isBag(item) && !ALLOW_BAG_IN_BAG ? "§cใส่ถุงในถุงไม่ได้" : "§8แตะเพื่อใส่ถุง"), iconOf(item));
  }
  return form;
}

function showBag(s, attempt = 0) {
  const player = s.player;
  if (sessions.get(s.playerId) !== s || s.state !== "active") return;
  if (!alive(player) || s.pages.some((e) => !e?.isValid)) return endSession(s);
  const inv = playerInv(player);
  if (!inv) return endSession(s);
  buildForm(s, inv)
    .show(player)
    .then((res) => {
      if (sessions.get(s.playerId) !== s) return;
      if (res.canceled) {
        if (res.cancelationReason === "UserBusy" && attempt < 40) {
          system.runTimeout(() => showBag(s, attempt + 1), 5);
          return;
        }
        return endSession(s);
      }
      if (!alive(player) || s.pages.some((e) => !e?.isValid)) return endSession(s);
      click(s, res.selection ?? -1);
      system.run(() => showBag(s));
    })
    .catch((err) => {
      console.warn(`[TieredBundles] form: ${err}`);
      if (sessions.get(s.playerId) === s) endSession(s);
    });
}

function click(s, sel) {
  const player = s.player;
  const inv = playerInv(player);
  if (!inv) return;
  if (sel >= 0 && sel < PER_PAGE) {
    // หยิบของออกจากถุง
    if (sel >= pageCap(s)) return;
    const pg = container(s.pages[s.page]);
    if (!pg.getItem(sel)) return;
    if (moveStack(pg, sel, inv, range(0, inv.size))) player.onScreenDisplay.setActionBar("§cกระเป๋าเต็ม");
    sound(player, "random.pop", 1.2);
  } else if (sel === SLOT_PREV && s.page > 0) {
    s.page--;
    sound(player, "item.book.page_turn");
  } else if (sel === SLOT_NEXT && s.page < s.total - 1) {
    s.page++;
    sound(player, "item.book.page_turn");
  } else if (sel >= INV_START && sel - INV_START < inv.size) {
    // ใส่ของจากกระเป๋าลงถุง: หน้าที่เปิดอยู่ก่อน เต็มแล้วค่อยใส่หน้าอื่น
    const slot = sel - INV_START;
    const item = inv.getItem(slot);
    if (!item) return;
    if (!ALLOW_BAG_IN_BAG && isBag(item)) {
      player.onScreenDisplay.setActionBar("§cใส่ถุงไว้ในถุงไม่ได้");
      return;
    }
    const order = [s.page, ...range(0, s.total).filter((n) => n !== s.page)];
    let left = item.amount;
    for (const n of order) {
      left = moveStack(inv, slot, container(s.pages[n]), range(0, pageCap(s, n)));
      if (!left) break;
    }
    if (left) player.onScreenDisplay.setActionBar("§cถุงเต็มแล้ว");
    sound(player, "random.pop", 0.9);
  }
}

// ---------------------------------------------------------------------------
// เปิด/ปิดถุง: โหลดหน้าจาก structure -> เปิดฟอร์ม -> ปิดฟอร์มแล้วบันทึกกลับ
// ---------------------------------------------------------------------------

// entity เก็บของอยู่ใต้เพดานโลกตรงหัวผู้เล่น (chunk เดียวกับผู้เล่น จึงโหลดอยู่เสมอ)
function anchorFor(player, id) {
  const top = player.dimension.heightRange.max;
  return {
    x: Math.floor(player.location.x) + 0.5,
    y: top - 2 - (hashId(id) % 12),
    z: Math.floor(player.location.z) + 0.5,
  };
}

function findTagged(id) {
  const tags = [TAG_ID + id];
  const pages = [];
  const uis = [];
  for (const d of DIMENSIONS) {
    const dim = world.getDimension(d);
    pages.push(...dim.getEntities({ type: PAGE, tags }));
    uis.push(...dim.getEntities({ type: OLD_UI, tags }));
  }
  return { pages, uis };
}

function openBag(player) {
  if (sessions.has(player.id) || !alive(player)) return;
  if ((lastOpen.get(player.id) ?? -99) + 6 > tick) return;
  lastOpen.set(player.id, tick);
  const inv = playerInv(player);
  if (!inv) return;
  if (tick - (joinedAt.get(player.id) ?? tick) < JOIN_DELAY) {
    player.onScreenDisplay.setActionBar("§7กำลังโหลดโลก รอสักครู่แล้วลองเปิดถุงใหม่");
    return;
  }
  const slot = player.selectedSlotIndex;
  scanBags(player, inv); // ถุงที่เพิ่งคราฟอัปเกรดลงมือพอดี ต้องรู้ก่อนว่าถุงเก่าเพิ่งหายไป
  const id = ensureId(player, inv, slot);
  const item = inv.getItem(slot);
  if (!id || !isBag(item)) return;
  for (const o of sessions.values()) {
    if (o.bagId === id) {
      player.onScreenDisplay.setActionBar("§cถุงใบนี้มีคนเปิดอยู่");
      return;
    }
  }
  const info = BAGS[item.typeId];
  const s = {
    player,
    playerId: player.id,
    bagId: id,
    typeId: item.typeId,
    slots: info.slots,
    total: Math.ceil(info.slots / PER_PAGE),
    page: 0,
    dim: player.dimension,
    anchor: anchorFor(player, id),
    pages: [],
    state: "loading",
    since: tick,
  };
  sessions.set(player.id, s);
  const found = findTagged(id);
  if (found.pages.length === 0 && world.structureManager.get(structId(id))) {
    try {
      world.structureManager.place(structId(id), s.dim, floorVec(s.anchor), { includeBlocks: false, includeEntities: true });
      s.state = "placing"; // entity จาก structure จะเจอใน tick ถัดไป
    } catch (err) {
      console.warn(`[TieredBundles] load ${id} failed: ${err}`);
      sessions.delete(player.id);
      player.sendMessage("§c[ถุง] โหลดของในถุงไม่สำเร็จ ลองเปิดใหม่อีกครั้ง");
    }
    return;
  }
  finishLoad(s, found);
}

function finishLoad(s, found) {
  const pages = [];
  const extra = [];
  for (const e of found.pages) {
    const n = pageOf(e);
    if (n === undefined || pages[n]) extra.push(e);
    else pages[n] = e;
  }
  for (let n = 0; n < Math.max(s.total, pages.length); n++) {
    if (pages[n]) continue;
    const e = s.dim.spawnEntity(PAGE, s.anchor);
    e.addTag(TAG_ID + s.bagId);
    e.addTag(TAG_PAGE + n);
    hide(e);
    pages[n] = e;
  }
  for (const e of pages) e.teleport(s.anchor, { dimension: s.dim });
  s.pages = pages;
  // ของที่ค้างจากรอบก่อน (หน้าซ้ำ / หน้าต่างของเวอร์ชันเก่า) เทกลับเข้าหน้าของมัน
  for (const e of [...extra, ...found.uis]) {
    pourInto(container(e), pages, pageOf(e) ?? 0, s);
    discard(e);
  }
  s.state = "active";
  showBag(s);
}

// เทของจาก container หนึ่งลงหน้าที่ n (ช่องเดิมถ้าว่าง) ที่เหลือใส่หน้าอื่น เต็มหมดค่อยคืนผู้เล่น/วางลงพื้น
function pourInto(from, pages, n, s) {
  if (!from) return;
  const target = container(pages[n]) ?? container(pages[0]);
  const at = pages.find((e) => e?.isValid);
  const drop = (item) => {
    if (s?.player.isValid) {
      const left = playerInv(s.player)?.addItem(item);
      if (left) s.player.dimension.spawnItem(left, s.player.location);
    } else at?.dimension.spawnItem(item, at.location);
  };
  for (let i = 0; i < Math.min(from.size, PER_PAGE); i++) {
    const item = from.getItem(i);
    if (!item) continue;
    if (item.typeId.startsWith("bt:btn_")) {
      from.setItem(i);
      continue;
    }
    if (!ALLOW_BAG_IN_BAG && isBag(item)) {
      from.setItem(i);
      drop(item);
      continue;
    }
    if (target && i < target.size && !target.getItem(i)) {
      from.moveItem(i, i, target);
      continue;
    }
    let left = item.amount;
    for (const p of pages) {
      const c = container(p);
      if (c) left = moveStack(from, i, c, range(0, c.size));
      if (!left) break;
    }
    if (left) {
      const rest = from.getItem(i);
      from.setItem(i);
      if (rest) drop(rest);
    }
  }
}

function updateSession(s) {
  if (s.state === "placing") {
    const found = findTagged(s.bagId);
    if (found.pages.length) {
      removeForeignCopies(s);
      finishLoad(s, found);
    } else if (tick - s.since > 100) {
      sessions.delete(s.playerId);
      s.player.sendMessage("§c[ถุง] โหลดของในถุงไม่สำเร็จ ลองเปิดใหม่อีกครั้ง");
    }
    return;
  }
  if (s.state !== "active") return;
  const a = anchorFor(s.player, s.bagId);
  if (a.x !== s.anchor.x || a.z !== s.anchor.z) {
    s.anchor = a;
    for (const e of s.pages) if (e?.isValid) e.teleport(a);
  }
}

function endSession(s) {
  if (sessions.get(s.playerId) === s) sessions.delete(s.playerId);
  if (s.state !== "active") return;
  s.state = "closed";
  if (s.pages.some((e) => !e?.isValid)) {
    // มีบางหน้าหลุดโหลด: ไม่บันทึกทับ ปล่อยให้รอบตรวจ (sweep) บันทึกตอนโหลดกลับมา
    console.warn(`[TieredBundles] bag ${s.bagId}: page entity unloaded, saving deferred`);
    return;
  }
  savePages(s.bagId, s.pages);
}

// บันทึกทุกหน้าเป็น structure ในโลก (เก็บข้อมูลไอเท็มครบ: เอนชานท์ ชื่อ ของในกล่อง ฯลฯ) แล้วลบ entity
function savePages(id, pages) {
  const list = pages.filter((e) => e?.isValid);
  if (!list.length) return false;
  const dim = list[0].dimension;
  const loc = list[0].location;
  if (list.some((e) => e.dimension.id !== dim.id || dist2(e.location, loc) > 0.01)) {
    for (const e of list) e.teleport(loc, { dimension: dim });
    return false; // รอให้ย้ายมาที่เดียวกันก่อน รอบตรวจถัดไปจะบันทึก
  }
  const sid = structId(id);
  const block = floorVec(loc);
  try {
    if (world.structureManager.get(sid)) world.structureManager.delete(sid);
    world.structureManager.createFromWorld(sid, dim, block, block, {
      includeBlocks: false,
      includeEntities: true,
      saveMode: StructureSaveMode.World,
    });
  } catch (err) {
    console.warn(`[TieredBundles] save ${id} failed: ${err}`);
    return false;
  }
  for (const e of list) discard(e);
  return true;
}

// structure อาจติดหน้าของถุงใบอื่นที่บังเอิญอยู่ตำแหน่งเดียวกันตอนบันทึกมาด้วย ลบสำเนานั้นทิ้ง
function removeForeignCopies(s) {
  const owned = new Set();
  for (const o of sessions.values()) for (const e of o.pages) if (e?.isValid) owned.add(e.id);
  for (const e of s.dim.getEntities({ type: PAGE, location: s.anchor, maxDistance: 1.5 })) {
    if (!e.hasTag(TAG_ID + s.bagId) && !owned.has(e.id)) discard(e);
  }
}

// entity ของถุงที่ไม่มีใครเปิดอยู่ (เกมปิดกลางคัน, /reload, ของจากเวอร์ชันเก่า) → บันทึกแล้วลบ
function sweep() {
  const live = new Set();
  for (const s of sessions.values()) for (const e of s.pages) if (e?.isValid) live.add(e.id);
  const groups = new Map();
  for (const d of DIMENSIONS) {
    const dim = world.getDimension(d);
    for (const type of [OLD_UI, PAGE]) {
      for (const e of dim.getEntities({ type })) {
        if (live.has(e.id)) continue;
        const id = tagValue(e, TAG_ID);
        if (!id) {
          discard(e);
          continue;
        }
        let g = groups.get(id);
        if (!g) groups.set(id, (g = { pages: [], uis: [] }));
        (type === OLD_UI ? g.uis : g.pages).push(e);
      }
    }
  }
  for (const [id, g] of groups) {
    const s = [...sessions.values()].find((o) => o.bagId === id);
    if (s) {
      // ถุงใบนี้เปิดอยู่แล้ว (โหลดจาก structure) ตัวที่ค้างเป็นสำเนาซ้ำ ลบทิ้งกันของเบิ้ล
      if (s.state === "active") for (const e of [...g.pages, ...g.uis]) discard(e);
      continue;
    }
    if (!g.pages.length) {
      // หาหน้าไม่เจอ (อยู่ใน chunk ที่ไม่ได้โหลด) วางของลงพื้นตรงนั้น
      for (const u of g.uis) {
        const c = container(u);
        for (let i = 0; c && i < PER_PAGE; i++) {
          const item = c.getItem(i);
          if (item && !item.typeId.startsWith("bt:btn_")) u.dimension.spawnItem(item, u.location);
        }
        discard(u);
      }
      continue;
    }
    const pages = [];
    const extra = [];
    for (const e of g.pages) {
      const n = pageOf(e);
      if (n === undefined || pages[n]) extra.push(e);
      else pages[n] = e;
    }
    const list = pages.filter(Boolean);
    for (const e of [...extra, ...g.uis]) {
      pourInto(container(e), list, Math.min(pageOf(e) ?? 0, list.length - 1), undefined);
      discard(e);
    }
    savePages(id, list);
  }
}

// ---------------------------------------------------------------------------
// เหตุการณ์
// ---------------------------------------------------------------------------

// กดใช้ถุง (แตะหน้าจอ / คลิกขวา) = เปิดถุง
world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (source?.typeId === "minecraft:player" && isBag(itemStack)) openBag(source);
});

// กดใช้ตอนเล็งบล็อก บางครั้งเกมไม่ส่ง itemUse -> ดักตรงนี้ด้วย (ยกเว้นบล็อกที่ใช้งานได้ เช่น หีบ ประตู)
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  if (!ev.isFirstEvent || !isBag(ev.itemStack) || INTERACTIVE.test(ev.block.typeId)) return;
  ev.cancel = true; // ไม่ให้วางของ/ใช้บล็อกตอนกดเปิดถุง
  const player = ev.player;
  system.run(() => player.isValid && openBag(player));
});

// หน้าเก็บของบนเพดานโลกห้ามเปิดตรง ๆ
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  if (ev.target.typeId === PAGE || ev.target.typeId === OLD_UI) ev.cancel = true;
});

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (initialSpawn) joinedAt.set(player.id, tick);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  const s = sessions.get(playerId);
  if (s) endSession(s);
  joinedAt.delete(playerId);
  memory.delete(playerId);
  lastOpen.delete(playerId);
});

// ---------------------------------------------------------------------------
// ลูปหลัก
// ---------------------------------------------------------------------------

system.runInterval(() => {
  tick++;
  for (const player of world.getAllPlayers()) {
    try {
      if (!joinedAt.has(player.id)) joinedAt.set(player.id, tick);
      const inv = playerInv(player);
      if (inv && tick % 5 === 0) scanBags(player, inv);
      const s = sessions.get(player.id);
      if (s && (!alive(player) || player.dimension.id !== s.dim.id)) endSession(s);
      else if (s) updateSession(s);
    } catch (err) {
      console.warn(`[TieredBundles] ${err}`);
    }
  }
  for (const s of [...sessions.values()]) if (!s.player.isValid) endSession(s);
  if (tick % SWEEP_INTERVAL === 0) {
    try {
      sweep();
    } catch (err) {
      console.warn(`[TieredBundles] sweep: ${err}`);
    }
  }
}, 1);

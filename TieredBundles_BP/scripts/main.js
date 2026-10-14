import { world, system, ItemStack, StructureSaveMode } from "@minecraft/server";

// ===== ตั้งค่า =====
// ถุงแต่ละระดับ: จำนวนช่องเก็บของทั้งหมด (หน้าละ 45 ช่อง แถวล่างสุดเป็นปุ่ม)
const BAGS = {
  "bt:bundle_leather": { tier: 1, slots: 9, name: "ถุงหนัง" },
  "bt:bundle_iron": { tier: 2, slots: 27, name: "ถุงเหล็ก" },
  "bt:bundle_gold": { tier: 3, slots: 54, name: "ถุงทอง" },
  "bt:bundle_diamond": { tier: 4, slots: 108, name: "ถุงเพชร" },
  "bt:bundle_netherite": { tier: 5, slots: 216, name: "ถุงเนเทอไรท์" },
};
const UI_DISTANCE = 2; // ตัวเปิดถุง (มองไม่เห็น) ลอยอยู่หน้าผู้เล่นห่างกี่บล็อก
const JOIN_DELAY = 60; // หลังเข้าโลก รอกี่ tick ก่อนเปิดถุงได้ (ให้ chunk โหลดเสร็จก่อน)
const UPGRADE_WINDOW = 6000; // ถุงที่หายจากกระเป๋า (เอาไปวางในโต๊ะคราฟ) จำไว้กี่ tick เพื่อย้ายของไปถุงขั้นถัดไป
const SWEEP_INTERVAL = 100; // ตรวจหาถุงที่ค้างอยู่ในโลก (เช่น ปิดเกมตอนถือถุง) แล้วบันทึกทุกกี่ tick
const ALLOW_BAG_IN_BAG = false; // ใส่ถุงไว้ในถุงได้ไหม
// ===================

const UI = "bt:bag_ui"; // entity ที่ผู้เล่นแตะแล้วเปิดหน้าต่างกล่องใหญ่ 54 ช่อง (ลอยหน้าผู้เล่นตอนถือถุง)
const PAGE = "bt:bag_page"; // entity เก็บของ 1 หน้า (45 ช่อง) อยู่บนเพดานโลกตอนเปิดถุง ที่เหลือเก็บเป็น structure
const PER_PAGE = 45;
const UI_SIZE = 54;
const SLOT_PREV = 45;
const SLOT_INFO = 49;
const SLOT_NEXT = 53;
const BTN_NEXT = "bt:btn_next";
const BTN_PREV = "bt:btn_prev";
const BTN_INFO = "bt:btn_info";
const BTN_FILL = "bt:btn_fill";
const BTN_LOCK = "bt:btn_lock";
const P_ID = "bt:id"; // dynamic property บนไอเท็มถุง: รหัสถุง (ใช้ตั้งชื่อ structure ที่เก็บของ)
const TAG_ID = "bt_id:";
const TAG_PAGE = "bt_pg:";
const TAG_OWNER = "bt_owner:";
const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];

let tick = 0;
const sessions = new Map(); // player.id -> ถุงที่กำลังถืออยู่
const joinedAt = new Map(); // player.id -> tick ที่เข้าโลก
const memory = new Map(); // player.id -> { present: Map<id, tier>, vanished: [{ id, tier, at }] }
const retryAt = new Map(); // player.id -> tick ที่ลองโหลดถุงใหม่ได้ (หลังโหลดไม่สำเร็จ)

// ---------------------------------------------------------------------------
// เครื่องมือ
// ---------------------------------------------------------------------------

const isBag = (item) => !!item && item.typeId in BAGS;
const isButton = (item) => !!item && item.typeId.startsWith("bt:btn_");
const container = (entity) => entity?.getComponent("minecraft:inventory")?.container;
const structId = (id) => `bt:bag_${id}`;
const floorVec = (v) => ({ x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) });
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

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

// คืนของให้ผู้เล่น ถ้ากระเป๋าเต็ม (หรือผู้เล่นออกจากโลกแล้ว) วางลงพื้นแทน
function give(player, item, dim, loc) {
  let left = item;
  if (player?.isValid) {
    left = player.getComponent("minecraft:inventory")?.container?.addItem(item);
    dim = player.dimension;
    loc = player.location;
  }
  if (left && dim) dim.spawnItem(left, loc);
}

function giveTo(s, item) {
  const at = s.ui?.isValid ? s.ui : s.pages.find((e) => e?.isValid);
  give(s.player, item, at?.dimension ?? s.dim, at?.location ?? s.anchor);
}

// ---------------------------------------------------------------------------
// รหัสถุง + อัปเกรด (ของในถุงเดิมย้ายไปถุงขั้นถัดไปเอง)
// ---------------------------------------------------------------------------

function bagLore(typeId) {
  return [`§r§7ช่องเก็บของ: §f${BAGS[typeId].slots} ช่อง`, "§r§8ถือแล้วแตะหน้าจอ / คลิกขวา เพื่อเปิด"];
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
    if (item.getLore()[0] !== lore[0]) {
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
  const unassigned = [];
  for (let i = 0; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (!isBag(item)) continue;
    const id = bagId(item);
    if (id) now.set(id, BAGS[item.typeId].tier);
    else unassigned.push(i);
  }
  const cur = cursorItem(player);
  if (isBag(cur) && bagId(cur)) now.set(bagId(cur), BAGS[cur.typeId].tier);
  for (const [id, tier] of m.present) if (!now.has(id)) m.vanished.push({ id, tier, at: tick });
  m.vanished = m.vanished.filter((v) => !now.has(v.id) && tick - v.at < UPGRADE_WINDOW);
  m.present = now;
  for (const slot of unassigned) ensureId(player, inv, slot);
  // ถุงที่มีรหัสแล้วแต่คำอธิบายไม่ตรงระดับ (อัปเกรดที่โต๊ะตีเหล็ก)
  for (let i = 0; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (isBag(item) && bagId(item) && item.getLore()[0] !== bagLore(item.typeId)[0]) ensureId(player, inv, i);
  }
}

// ---------------------------------------------------------------------------
// หน้าต่างถุง: ช่อง 0-44 ของ, แถวล่าง 45-53 ปุ่มกระจกสี
// ---------------------------------------------------------------------------

const pageCap = (s, n = s.page) => Math.max(0, Math.min(PER_PAGE, s.slots - n * PER_PAGE));

function rowType(s, slot) {
  if (slot === SLOT_PREV) return s.page > 0 ? BTN_PREV : BTN_FILL;
  if (slot === SLOT_NEXT) return s.page < s.total - 1 ? BTN_NEXT : BTN_FILL;
  if (slot === SLOT_INFO) return BTN_INFO;
  return BTN_FILL;
}

function button(type, name, lore) {
  const item = new ItemStack(type, 1);
  item.nameTag = name;
  if (lore) item.setLore(lore);
  return item;
}

function rowItem(s, slot) {
  const type = rowType(s, slot);
  if (type === BTN_NEXT) return button(type, "§r§a§lหน้าถัดไป ▶", [`§r§7ไปหน้า ${s.page + 2}/${s.total}`]);
  if (type === BTN_PREV) return button(type, "§r§c§l◀ หน้าก่อนหน้า", [`§r§7ไปหน้า ${s.page}/${s.total}`]);
  if (type === BTN_INFO)
    return button(type, `§r§e§lหน้า ${s.page + 1}/${s.total}`, [
      `§r§7${BAGS[s.typeId].name}: §f${s.slots} ช่อง`,
      `§r§7หน้านี้: §f${pageCap(s)} ช่อง`,
    ]);
  return button(type, "§r ");
}

function lockItem(s) {
  const max = BAGS[s.typeId].tier >= 5;
  return button(BTN_LOCK, "§r§7ช่องล็อก", [max ? "§r§8ถุงความจุสูงสุดแล้ว" : "§r§8อัปเกรดถุงเพื่อเพิ่มช่อง"]);
}

// วางปุ่ม/ช่องล็อกให้ถูก คืนค่า +1/-1 ถ้าผู้เล่นกดปุ่มเปลี่ยนหน้า (ปุ่มหายไปจากช่อง)
function checkLayout(s, force) {
  const ui = container(s.ui);
  const cap = pageCap(s);
  let action = 0;
  for (let i = 0; i < PER_PAGE; i++) {
    const item = ui.getItem(i);
    if (i < cap) {
      if (!item) continue;
      if (isButton(item)) ui.setItem(i);
      else if (!ALLOW_BAG_IN_BAG && isBag(item)) {
        ui.setItem(i);
        giveTo(s, item);
        s.player?.isValid && s.player.onScreenDisplay.setActionBar("§cใส่ถุงไว้ในถุงไม่ได้");
      }
    } else if (item?.typeId !== BTN_LOCK) {
      if (item && !isButton(item)) giveTo(s, item);
      ui.setItem(i, lockItem(s));
    }
  }
  for (let slot = PER_PAGE; slot < UI_SIZE; slot++) {
    const want = rowType(s, slot);
    const item = ui.getItem(slot);
    if (!force && item?.typeId === want) continue;
    if (!force && slot === SLOT_NEXT && want === BTN_NEXT) action = 1;
    if (!force && slot === SLOT_PREV && want === BTN_PREV) action = -1;
    if (item && !isButton(item)) giveTo(s, item); // ผู้เล่นสลับของตัวเองลงช่องปุ่ม
    ui.setItem(slot, rowItem(s, slot));
  }
  return action;
}

// ย้ายของหน้าปัจจุบันจากหน้าต่างกลับไปเก็บใน entity ของหน้านั้น
function unloadPage(s) {
  const ui = container(s.ui);
  const pg = container(s.pages[s.page]);
  for (let i = 0; i < PER_PAGE; i++) {
    const item = ui.getItem(i);
    if (!item) continue;
    if (isButton(item)) ui.setItem(i);
    else if (!ALLOW_BAG_IN_BAG && isBag(item)) {
      ui.setItem(i);
      giveTo(s, item);
    } else if (!pg.getItem(i)) ui.swapItems(i, i, pg);
    else {
      ui.setItem(i);
      stash(s, item);
    }
  }
  for (let slot = PER_PAGE; slot < UI_SIZE; slot++) ui.setItem(slot);
}

function loadPage(s, n) {
  const ui = container(s.ui);
  const pg = container(s.pages[n]);
  s.page = n;
  for (let i = 0; i < PER_PAGE; i++) {
    const old = ui.getItem(i);
    if (old) {
      ui.setItem(i);
      if (!isButton(old)) giveTo(s, old);
    }
    if (pg.getItem(i)) ui.swapItems(i, i, pg);
  }
  const oldTag = s.ui.getTags().find((t) => t.startsWith(TAG_PAGE));
  if (oldTag) s.ui.removeTag(oldTag);
  s.ui.addTag(TAG_PAGE + n);
  checkLayout(s, true);
}

function changePage(s, n) {
  if (n < 0 || n >= s.total || n === s.page) return checkLayout(s, true);
  unloadPage(s);
  loadPage(s, n);
  try {
    s.player.playSound("item.book.page_turn");
  } catch {}
}

// ใส่ของลงช่องว่างช่องแรกของหน้าไหนก็ได้ (ไม่ใส่ในช่องล็อก) เต็มหมดค่อยคืนผู้เล่น
function stash(s, item) {
  for (let n = 0; n < s.pages.length; n++) {
    const c = container(s.pages[n]);
    if (!c) continue;
    const cap = pageCap(s, n);
    for (let i = 0; i < cap; i++) {
      if (!c.getItem(i)) {
        c.setItem(i, item);
        return;
      }
    }
  }
  giveTo(s, item);
}

// ---------------------------------------------------------------------------
// เปิด/ปิดถุง
// ---------------------------------------------------------------------------

function uiPos(player) {
  const h = player.getHeadLocation();
  const d = player.getViewDirection();
  return { x: h.x + d.x * UI_DISTANCE, y: h.y + d.y * UI_DISTANCE - 0.5, z: h.z + d.z * UI_DISTANCE };
}

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
    uis.push(...dim.getEntities({ type: UI, tags }));
  }
  return { pages, uis };
}

function startSession(player, inv) {
  if ((retryAt.get(player.id) ?? 0) > tick) return;
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
    ui: undefined,
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
      retryAt.set(player.id, tick + 100);
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
  // ของที่ค้างจากรอบก่อน (เช่น ปิดเกมตอนถือถุงอยู่) เทกลับเข้าหน้าของมัน
  for (const e of [...extra, ...found.uis]) {
    pourInto(container(e), pages, pageOf(e) ?? 0, s);
    discard(e);
  }
  const ui = s.dim.spawnEntity(UI, uiPos(s.player));
  ui.addTag(TAG_ID + s.bagId);
  ui.addTag(TAG_OWNER + s.playerId);
  ui.addTag(TAG_PAGE + 0);
  hide(ui);
  s.ui = ui;
  s.state = "active";
  loadPage(s, 0);
  s.player.onScreenDisplay.setActionBar(`§e${BAGS[s.typeId].name} §7(${s.slots} ช่อง) — แตะหน้าจอ / คลิกขวา เพื่อเปิด`);
}

// เทของจาก container หนึ่งลงหน้าที่ n (ช่องเดิมถ้าว่าง) ที่เหลือใส่ช่องว่างหน้าอื่น เต็มหมดค่อยวางลงพื้น
function pourInto(from, pages, n, s) {
  if (!from) return;
  const target = container(pages[n]) ?? container(pages[0]);
  const at = pages.find((e) => e?.isValid);
  for (let i = 0; i < Math.min(from.size, PER_PAGE); i++) {
    const item = from.getItem(i);
    if (!item) continue;
    from.setItem(i);
    if (isButton(item)) continue;
    if (!ALLOW_BAG_IN_BAG && isBag(item)) {
      if (s) giveTo(s, item);
      else at?.dimension.spawnItem(item, at.location);
      continue;
    }
    if (target && !target.getItem(i)) {
      target.setItem(i, item);
      continue;
    }
    let left = item;
    for (const p of pages) {
      left = container(p)?.addItem(left);
      if (!left) break;
    }
    if (left) {
      if (s) giveTo(s, left);
      else at?.dimension.spawnItem(left, at.location);
    }
  }
}

function updateSession(s) {
  const player = s.player;
  if (s.state === "placing") {
    const found = findTagged(s.bagId);
    if (found.pages.length) {
      removeForeignCopies(s);
      finishLoad(s, found);
    } else if (tick - s.since > 100) {
      sessions.delete(s.playerId);
      retryAt.set(s.playerId, tick + 100);
      player.sendMessage("§c[ถุง] โหลดของในถุงไม่สำเร็จ จะลองใหม่อีกครั้ง");
    }
    return;
  }
  if (s.pages.some((e) => !e?.isValid)) return abortSession(s);
  if (!s.ui?.isValid) {
    // ตัวเปิดถุงหายไป (โดนคำสั่ง /kill) สร้างใหม่ ของหน้านี้หล่นอยู่ที่พื้นแล้ว
    s.ui = s.dim.spawnEntity(UI, uiPos(player));
    s.ui.addTag(TAG_ID + s.bagId);
    s.ui.addTag(TAG_OWNER + s.playerId);
    s.ui.addTag(TAG_PAGE + s.page);
    hide(s.ui);
    checkLayout(s, true);
  }
  const pos = uiPos(player);
  if (dist2(pos, s.ui.location) > 0.09) s.ui.teleport(pos);
  const a = anchorFor(player, s.bagId);
  if (a.x !== s.anchor.x || a.z !== s.anchor.z) {
    s.anchor = a;
    for (const e of s.pages) e.teleport(a);
  }
  const action = checkLayout(s, false);
  if (action) changePage(s, s.page + action);
}

function endSession(s) {
  sessions.delete(s.playerId);
  if (s.state !== "active") return;
  if (s.pages.some((e) => !e?.isValid)) return abortSession(s);
  if (s.ui?.isValid) {
    unloadPage(s);
    discard(s.ui);
  }
  savePages(s.bagId, s.pages);
}

// มีบางหน้าหลุดโหลด: ไม่บันทึกทับ ปล่อย entity ที่เหลือไว้ให้รอบตรวจ (sweep) จัดการตอนโหลดกลับมา
function abortSession(s) {
  sessions.delete(s.playerId);
  console.warn(`[TieredBundles] bag ${s.bagId}: page entity unloaded, saving deferred`);
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

// entity ของถุงที่ไม่มีใครถืออยู่ (เกมปิดกลางคัน, /reload) → บันทึกแล้วลบ
function sweep() {
  const live = new Set();
  for (const s of sessions.values()) {
    if (s.ui?.isValid) live.add(s.ui.id);
    for (const e of s.pages) if (e?.isValid) live.add(e.id);
  }
  const groups = new Map();
  for (const d of DIMENSIONS) {
    const dim = world.getDimension(d);
    for (const type of [UI, PAGE]) {
      for (const e of dim.getEntities({ type })) {
        if (live.has(e.id)) continue;
        const id = tagValue(e, TAG_ID);
        if (!id) {
          discard(e);
          continue;
        }
        let g = groups.get(id);
        if (!g) groups.set(id, (g = { pages: [], uis: [] }));
        (type === UI ? g.uis : g.pages).push(e);
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
      // หาหน้าไม่เจอ (อยู่ใน chunk ที่ไม่ได้โหลด) วางของในหน้าต่างลงพื้นตรงนั้น
      for (const u of g.uis) {
        const c = container(u);
        for (let i = 0; c && i < PER_PAGE; i++) {
          const item = c.getItem(i);
          if (item && !isButton(item)) u.dimension.spawnItem(item, u.location);
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
// ปุ่มกระจกห้ามหลุดออกจากหน้าต่าง
// ---------------------------------------------------------------------------

function purgeButtons(player, inv) {
  for (let i = 0; i < inv.size; i++) if (isButton(inv.getItem(i))) inv.setItem(i);
  try {
    const cur = player.getComponent("minecraft:cursor_inventory");
    if (isButton(cur?.item)) cur.clear();
  } catch {}
}

world.afterEvents.entitySpawn.subscribe(({ entity }) => {
  if (!entity.isValid || entity.typeId !== "minecraft:item") return;
  if (isButton(entity.getComponent("minecraft:item")?.itemStack)) entity.remove();
});

// เปิดได้เฉพาะถุงของตัวเอง หน้าเก็บของบนเพดานโลกห้ามเปิดตรง ๆ
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const t = ev.target;
  if (t.typeId === PAGE) ev.cancel = true;
  else if (t.typeId === UI && sessions.get(ev.player.id)?.ui?.id !== t.id) ev.cancel = true;
});

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (initialSpawn) joinedAt.set(player.id, tick);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  const s = sessions.get(playerId);
  if (s) endSession(s);
  joinedAt.delete(playerId);
  memory.delete(playerId);
  retryAt.delete(playerId);
});

// ---------------------------------------------------------------------------
// ลูปหลัก
// ---------------------------------------------------------------------------

function handlePlayer(player) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  if (!joinedAt.has(player.id)) joinedAt.set(player.id, tick);
  if (tick % 5 === 0) scanBags(player, inv);

  const held = inv.getItem(player.selectedSlotIndex);
  const heldId = isBag(held) ? bagId(held) : undefined;
  const alive = (player.getComponent("minecraft:health")?.currentValue ?? 1) > 0;
  let s = sessions.get(player.id);
  if (s && (!alive || heldId !== s.bagId || held.typeId !== s.typeId || player.dimension.id !== s.dim.id)) {
    endSession(s);
    s = undefined;
  }
  if (s) updateSession(s);
  else if (alive && isBag(held) && tick - joinedAt.get(player.id) >= JOIN_DELAY) startSession(player, inv);

  if (sessions.has(player.id) || tick % 20 === 0) purgeButtons(player, inv);
}

system.runInterval(() => {
  tick++;
  for (const player of world.getAllPlayers()) {
    try {
      handlePlayer(player);
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

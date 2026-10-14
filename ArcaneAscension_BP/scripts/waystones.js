import { world, system, LocationWaypoint, WaypointTexture } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { WAYSTONE_MANA_COST } from "./config.js";
import { getData, saveData, getWorld, setWorld } from "./data.js";
import { questProgress, addMana } from "./progression.js";
import { fx, COL, sound, psound, fade } from "./fx.js";
import { V, alive, safe, tell, actionbar, isCreative, isOp, fmt, showForm } from "./util.js";

const KEY = "arc:waystones";
const DIM_NAME = { "minecraft:overworld": "โลกปกติ", "minecraft:nether": "เนเธอร์", "minecraft:the_end": "The End" };

export const wsId = (dimId, l) => `${dimId}|${Math.floor(l.x)}|${Math.floor(l.y)}|${Math.floor(l.z)}`;

export function allWaystones() {
  return getWorld(KEY, []);
}

function save(list) {
  setWorld(KEY, list);
}

function find(id) {
  return allWaystones().find((w) => w.id === id);
}

export function registerWaystone(block, player, name) {
  const list = allWaystones();
  const id = wsId(block.dimension.id, block.location);
  let w = list.find((x) => x.id === id);
  if (!w) {
    w = { id, name: name ?? `หินวาร์ป #${list.length + 1}`, dim: block.dimension.id, x: block.x, y: block.y, z: block.z, owner: player?.name ?? "" };
    list.push(w);
    save(list);
  }
  if (player) discover(player, w, false);
  return w;
}

function discover(player, w, announce = true) {
  const d = getData(player);
  if (d.ways.includes(w.id)) return;
  d.ways.push(w.id);
  saveData(player);
  refreshWaypoints(player);
  if (announce) {
    actionbar(player, `§d✦ ค้นพบหินวาร์ป: §f${w.name}`);
    psound(player, "beacon.activate", 0.7, 1.6);
    fx.rise(player.dimension, { x: w.x + 0.5, y: w.y + 1, z: w.z + 0.5 }, COL.arcane, 0.6, 16, 2.5);
  }
}

function rename(player, w) {
  showForm(new ModalFormData()
    .title("§dตั้งชื่อหินวาร์ป")
    .textField("ชื่อ", "เช่น บ้าน, เหมือง, หมู่บ้าน", { defaultValue: w.name })
    .submitButton("บันทึก"), player)
    .then((res) => {
      if (res.canceled) return;
      const name = String(res.formValues?.[0] ?? "").trim().slice(0, 32);
      if (!name) return;
      const list = allWaystones();
      const it = list.find((x) => x.id === w.id);
      if (!it) return;
      it.name = name;
      save(list);
      tell(player, `§d✦ ตั้งชื่อหินวาร์ปเป็น §f${name}`);
      for (const p of world.getAllPlayers()) refreshWaypoints(p);
    });
}

export function openWaystoneMenu(player, here) {
  const d = getData(player);
  const all = allWaystones();
  const known = all.filter((w) => d.ways.includes(w.id) && (!here || w.id !== here.id));
  const pl = player.location;
  known.sort((a, b) => {
    const sa = a.dim === player.dimension.id ? 0 : 1;
    const sb = b.dim === player.dimension.id ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return V.dist(pl, a) - V.dist(pl, b);
  });
  const form = new ActionFormData().title("§d§lเครือข่ายหินวาร์ป");
  const cost = isCreative(player) ? 0 : WAYSTONE_MANA_COST;
  form.body(`${here ? `§7ตอนนี้อยู่ที่: §f${here.name}\n` : ""}§7วาร์ปครั้งละ §b${cost} มานา §8(มี ${Math.floor(d.mana)})\n§8ค้นพบแล้ว ${known.length + (here ? 1 : 0)} จาก ${all.length} ก้อน`);
  const actions = [];
  for (const w of known) {
    const same = w.dim === player.dimension.id;
    const dist = same ? `${fmt(V.dist(pl, w))} บล็อก` : DIM_NAME[w.dim] ?? w.dim;
    form.button(`§l${w.name}§r\n§8${dist} • ${w.x}, ${w.y}, ${w.z}`, "textures/arc_ui/menu_waystones");
    actions.push(() => travel(player, w));
  }
  if (here && (here.owner === player.name || isOp(player) || !here.owner)) {
    form.button("§eตั้งชื่อหินวาร์ปนี้", "textures/arc_ui/menu_settings");
    actions.push(() => rename(player, here));
  }
  if (!actions.length) form.body("§7ยังไม่รู้จักหินวาร์ปอื่นเลย\n§8แตะหินวาร์ปที่อื่นเพื่อค้นพบ หรือสร้างใหม่: อิฐหิน 5 + เศษผลึก 3 + ไข่มุกเอนเดอร์");
  showForm(form, player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    actions[res.selection]?.();
  });
}

function travel(player, w) {
  const d = getData(player);
  const cost = isCreative(player) ? 0 : WAYSTONE_MANA_COST;
  if (d.mana < cost) {
    tell(player, `§9มานาไม่พอ (ต้องการ ${cost})`);
    return;
  }
  if (!find(w.id)) {
    tell(player, "§cหินวาร์ปนั้นถูกทำลายไปแล้ว");
    return;
  }
  const dim = safe(() => world.getDimension(w.dim));
  if (!dim) return;
  addMana(player, -cost);
  const from = { ...player.location };
  fx.implode(player.dimension, V.up(from, 1), COL.arcane, 2, 24);
  sound(player.dimension, "mob.endermen.portal", from, 1, 0.8);
  fade(player, { red: 0.3, green: 0.1, blue: 0.5 }, 0.2, 0.3, 0.6);
  system.runTimeout(() => {
    if (!alive(player)) return;
    const dest = { x: w.x + 0.5, y: w.y + 1, z: w.z + 1.5 };
    try {
      const ok = player.tryTeleport(dest, { dimension: dim, checkForBlocks: true });
      if (!ok) player.teleport({ x: w.x + 0.5, y: w.y + 1, z: w.z + 0.5 }, { dimension: dim });
    } catch (err) {
      tell(player, `§cวาร์ปไม่สำเร็จ: ${err}`);
      return;
    }
    system.runTimeout(() => {
      if (!alive(player)) return;
      // ตรวจว่าหินวาร์ปยังอยู่ (ตอนนี้ chunk โหลดแล้ว)
      const b = safe(() => dim.getBlock({ x: w.x, y: w.y, z: w.z }));
      if (b && b.typeId !== "arc:waystone") unregister(w.id);
      fx.burst(dim, V.up(player.location, 1), COL.arcane, 24, 5);
      fx.rune(dim, player.location, 1.6, COL.arcane, 1, 120);
      sound(dim, "beacon.power", player.location, 0.8, 1.6);
    }, 5);
  }, 6);
}

function unregister(id) {
  save(allWaystones().filter((w) => w.id !== id));
  for (const p of world.getAllPlayers()) refreshWaypoints(p);
}

// ---------- จุดบนแถบตำแหน่ง (Locator Bar) ----------
let waypointsOk = true;
const shown = new Map(); // player.id -> Map(waystone id -> waypoint)

export function refreshWaypoints(player) {
  if (!waypointsOk) return;
  try {
    const d = getData(player);
    const mine = shown.get(player.id) ?? new Map();
    shown.set(player.id, mine);
    const want = allWaystones()
      .filter((w) => d.ways.includes(w.id) && w.dim === player.dimension.id)
      .sort((a, b) => V.dist(player.location, a) - V.dist(player.location, b))
      .slice(0, 6);
    const wantIds = new Set(want.map((w) => w.id));
    for (const [id, wp] of mine) {
      if (wantIds.has(id)) continue;
      safe(() => player.locatorBar.removeWaypoint(wp));
      mine.delete(id);
    }
    for (const w of want) {
      if (mine.has(w.id)) continue;
      const wp = new LocationWaypoint(
        { x: w.x + 0.5, y: w.y + 1, z: w.z + 0.5, dimension: player.dimension },
        { textureBoundsList: [{ lowerBound: 0, texture: WaypointTexture.SmallSquare }] },
        { red: 0.78, green: 0.55, blue: 1 },
      );
      player.locatorBar.addWaypoint(wp);
      mine.set(w.id, wp);
    }
  } catch (err) {
    waypointsOk = false;
    console.warn(`[Arcane] locator bar disabled: ${err}`);
  }
}

// ---------- event ----------
export const waystoneComponent = {
  onPlayerInteract(ev) {
    const player = ev.player;
    if (!player) return;
    const w = registerWaystone(ev.block, undefined);
    const fresh = !getData(player).ways.includes(w.id);
    discover(player, w, true);
    if (fresh) return;
    system.run(() => openWaystoneMenu(player, w));
  },
};

export function initWaystones() {
  world.afterEvents.playerPlaceBlock.subscribe((ev) => {
    if (ev.block.typeId !== "arc:waystone") return;
    const w = registerWaystone(ev.block, ev.player);
    questProgress(ev.player, "waystone");
    fx.rune(ev.block.dimension, ev.block.location, 1.5, COL.arcane, 1.5, 90);
    sound(ev.block.dimension, "beacon.activate", ev.block.location, 1, 1.3);
    system.runTimeout(() => alive(ev.player) && rename(ev.player, w), 10);
  });
  world.afterEvents.playerBreakBlock.subscribe((ev) => {
    if (ev.brokenBlockPermutation.type.id !== "arc:waystone") return;
    unregister(wsId(ev.block.dimension.id, ev.block.location));
    tell(ev.player, "§7หินวาร์ปถูกทำลายและหายไปจากเครือข่าย");
  });
  world.afterEvents.playerDimensionChange.subscribe(({ player }) => system.runTimeout(() => alive(player) && refreshWaypoints(player), 20));
  world.afterEvents.playerSpawn.subscribe(({ player }) => system.runTimeout(() => alive(player) && refreshWaypoints(player), 40));
  system.runInterval(() => {
    for (const p of world.getAllPlayers()) refreshWaypoints(p);
  }, 200);
}

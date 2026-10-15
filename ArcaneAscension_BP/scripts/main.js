// =====================================================================
//  Arcane Ascension — มหาเวทข้ามมิติ (Minecraft Bedrock 1.26.50+)
//  Script API: @minecraft/server 2.10.0, @minecraft/server-ui 2.2.0
// =====================================================================
import { world, system, EntitySwingSource, ScriptEventSource } from "@minecraft/server";
import { STAFFS } from "./config.js";
import { getData, saveData, forget, startAutosave } from "./data.js";
import { initCombat, spellDamage } from "./combat.js";
import { initProjectiles, launch } from "./projectiles.js";
import { initProgression, setBloodMoonProbe, addMana } from "./progression.js";
import { initSpells, tryCast } from "./spells.js";
import { initMobs } from "./mobs.js";
import { initBosses, summonWithSigil } from "./bosses.js";
import { initWaystones, waystoneComponent } from "./waystones.js";
import { altarComponent } from "./altar.js";
import { initEvents, bloodMoonActive } from "./events.js";
import { initHud } from "./hud.js";
import { initOre, oreSense, handleOreBreak } from "./ore.js";
import { openGrimoire, openSpellWheel, cycleSpell } from "./ui.js";
import { registerCommands, ACTIONS } from "./commands.js";
import { fx, COL, sound, psound, forgetFog } from "./fx.js";
import { V, alive, safe, tell, title, isOp, eyeOf, giveItem } from "./util.js";

// ---------- ช่วงเริ่มต้น: บล็อกคอมโพเนนต์ + คำสั่ง ----------
system.beforeEvents.startup.subscribe((ev) => {
  try {
    ev.blockComponentRegistry.registerCustomComponent("arc:waystone_interact", waystoneComponent);
    ev.blockComponentRegistry.registerCustomComponent("arc:altar_interact", altarComponent);
  } catch (err) {
    console.warn(`[Arcane] block components: ${err}`);
  }
  try {
    registerCommands(ev.customCommandRegistry);
  } catch (err) {
    console.warn(`[Arcane] custom commands: ${err}`);
  }
});

// ---------- ไอเท็มพิเศษ ----------
const reaverCd = new Map();

function voidSlash(player) {
  const ready = reaverCd.get(player.id) ?? 0;
  if (system.currentTick < ready) return;
  reaverCd.set(player.id, system.currentTick + 100);
  const dir = player.getViewDirection();
  const flat = V.norm({ x: dir.x, y: 0, z: dir.z });
  const side = { x: -flat.z, y: 0, z: flat.x };
  launch({
    dim: player.dimension, pos: V.add(eyeOf(player), V.mul(dir, 1)), vel: V.mul(dir, 1.1), owner: player,
    life: 16, radius: 1.3, pierce: 6, ignoreBlocks: false,
    trail: (dim, pos) => {
      for (let k = -2; k <= 2; k++) fx.orb(dim, V.add(pos, V.mul(side, k * 0.45)), k === 0 ? COL.pink : COL.void, 0.32, 0.25);
    },
    onHitEntity: (e) => {
      spellDamage(e, 12, player);
      safe(() => e.addEffect("wither", 60, { amplifier: 1 }));
      fx.burst(e.dimension, V.up(e.location, 1), COL.void, 12, 4);
      return true;
    },
    onHitBlock: (pos) => fx.burst(player.dimension, pos, COL.void, 12, 3),
  });
  sound(player.dimension, "item.trident.riptide_1", player.location, 0.8, 1.4);
}

function onItemUse(player, item) {
  const id = item.typeId;
  if (STAFFS[id]) {
    if (player.isSneaking) openSpellWheel(player);
    else tryCast(player, item);
    return;
  }
  switch (id) {
    case "arc:grimoire":
      if (player.isSneaking) oreSense(player);
      else openGrimoire(player);
      break;
    case "arc:ember_sigil":
    case "arc:void_sigil":
      summonWithSigil(player, item);
      break;
    case "arc:void_reaver":
      voidSlash(player);
      break;
  }
}

// กดใช้ตอนเล็งบล็อก บางครั้งเกมไม่ส่ง itemUse -> ดักจาก playerInteractWithBlock ด้วย แล้วกันยิงซ้ำ
const USABLE = new Set(["arc:grimoire", "arc:ember_sigil", "arc:void_sigil", "arc:void_reaver"]);
const INTERACTIVE = /chest|barrel|door|gate|button|lever|crafting|furnace|smoker|anvil|table|shulker|hopper|dispenser|dropper|bed|bell|lectern|loom|stonecutter|grindstone|cartography|smithing|brewing|beacon|enchanting|composter|cauldron|jukebox|noteblock|repeater|comparator|daylight|respawn_anchor|lodestone|campfire|sign|frame|cake|candle|beehive|bee_nest|decorated_pot|crafter|vault|trial_spawner|waystone|altar|bookshelf|flower_pot|command_block|structure|jigsaw/;
const lastUse = new Map();

function useOnce(player, item) {
  const t = system.currentTick;
  if ((lastUse.get(player.id) ?? -99) + 4 > t) return;
  lastUse.set(player.id, t);
  onItemUse(player, item);
}

// ---------- ยามานา ----------
function onDrink(player, item) {
  if (item.typeId === "arc:mana_potion") {
    addMana(player, 40);
  } else if (item.typeId === "arc:greater_mana_potion") {
    addMana(player, 120);
    safe(() => player.addEffect("regeneration", 100, { amplifier: 1 }));
  } else return;
  fx.rise(player.dimension, player.location, COL.frost, 0.8, 16, 2.5);
  psound(player, "random.orb", 0.8, 1.4);
}

// ---------- ผู้เล่นเข้าเกม ----------
function onSpawn(player, initial) {
  if (initial) {
    forgetFog(player);
    safe(() => player.camera.clear());
  }
  const d = getData(player);
  if (initial && !d.gotBook) {
    d.gotBook = true;
    saveData(player);
    giveItem(player, "arc:grimoire", 1);
    system.runTimeout(() => {
      if (!alive(player)) return;
      title(player, "§d§lArcane Ascension", "§7คุณได้รับ §dคัมภีร์เวทอาร์เคน§7 — ถือแล้วกดใช้เพื่อเริ่ม", 20, 100, 30);
      tell(player, "§d✦ ยินดีต้อนรับสู่ Arcane Ascension! §7ขุดแร่อาร์เคน → คราฟคทา → เรียนคาถา • เปิดคัมภีร์เพื่ออ่านคู่มือ • พิมพ์ §f/arc:menu§7 ได้ทุกเมื่อ");
      psound(player, "beacon.activate", 1, 1.2);
    }, 60);
  }
}

// ---------- เริ่มทุกระบบเมื่อโลกโหลดเสร็จ ----------
world.afterEvents.worldLoad.subscribe(() => {
  setBloodMoonProbe(bloodMoonActive);
  initCombat();
  initProjectiles();
  initProgression();
  initSpells();
  initMobs();
  initBosses();
  initWaystones();
  initEvents();
  initHud();
  initOre();
  startAutosave();

  world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
    if (source?.typeId === "minecraft:player" && itemStack) useOnce(source, itemStack);
  });
  world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
    const item = ev.itemStack;
    if (!ev.isFirstEvent || !item || (!STAFFS[item.typeId] && !USABLE.has(item.typeId))) return;
    if (INTERACTIVE.test(ev.block.typeId)) return;
    const player = ev.player;
    system.run(() => alive(player) && useOnce(player, item));
  });
  world.afterEvents.itemCompleteUse.subscribe(({ source, itemStack }) => {
    if (itemStack) onDrink(source, itemStack);
  });
  world.afterEvents.playerSwingStart.subscribe(({ player, heldItemStack, swingSource }) => {
    if (!player.isSneaking || !heldItemStack || !STAFFS[heldItemStack.typeId]) return;
    if (swingSource === EntitySwingSource.Attack || swingSource === EntitySwingSource.None) cycleSpell(player);
  });
  world.afterEvents.playerBreakBlock.subscribe(handleOreBreak);
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => onSpawn(player, initialSpawn));
  world.beforeEvents.playerLeave.subscribe(({ player }) => {
    try {
      saveData(player);
    } catch {}
  });
  world.afterEvents.playerLeave.subscribe(({ playerId }) => forget(playerId));
  system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (!ev.id.startsWith("arc:")) return;
    const p = ev.sourceEntity;
    if (p?.typeId !== "minecraft:player") return;
    const name = ev.id.slice(4);
    const action = ACTIONS[name];
    if (!action) return tell(p, `§c[Arcane] ไม่รู้จักคำสั่ง ${name} §7(menu, stats, kit, max, bloodmoon, boss, reset, setlevel)`);
    if (!["menu", "stats"].includes(name) && !isOp(p) && ev.sourceType !== ScriptEventSource.Server) return tell(p, "§cต้องเป็น OP");
    action(p, ev.message.trim());
  });

  for (const p of world.getAllPlayers()) onSpawn(p, true);
  console.log(`[Arcane] Arcane Ascension loaded`);
});

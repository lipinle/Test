import { world, system, CommandPermissionLevel, CustomCommandParamType as T, CustomCommandStatus } from "@minecraft/server";
import * as lib from "./lib.js";
import { openMenu } from "./menu.js";

const NS = "cheat";

// รายการคำสั่งทั้งหมด (ใช้ทั้งลงทะเบียนและแสดงใน /cmds)
// args: [ชื่อ, ชนิด, ไม่บังคับ?]
const COMMANDS = [];

function sourcePlayer(origin) {
  for (const e of [origin.sourceEntity, origin.initiator]) {
    if (e?.typeId === "minecraft:player") return e;
  }
  return undefined;
}

/**
 * @param {string} name
 * @param {string} help คำอธิบายภาษาไทย
 * @param {[string, string, boolean?][]} args
 * @param {(ctx: {player: any, origin: any}, ...args: any[]) => void} run
 * @param {{needPlayer?: boolean, group?: string}} [opts]
 */
function command(name, help, args, run, opts = {}) {
  COMMANDS.push({ name, help, args, run, needPlayer: opts.needPlayer ?? true, group: opts.group ?? "อื่น ๆ" });
}

function usage(cmd) {
  const args = cmd.args.map(([n, , optional]) => (optional ? `[${n}]` : `<${n}>`)).join(" ");
  return `/${cmd.name}${args ? " " + args : ""}`;
}

// เป้าหมาย: ผู้เล่นที่ระบุ หรือตัวเอง
function targets(ctx, selected) {
  if (selected?.length) return selected;
  return ctx.player ? [ctx.player] : [];
}

function names(players) {
  return players.map((p) => p.name).join(", ");
}

function toggleArg(value, current) {
  if (value === "on") return true;
  if (value === "off") return false;
  return !current;
}

// ===================== โหมดเกม =====================
for (const [key, mode] of Object.entries(lib.GAME_MODES)) {
  command(
    `gm${key}`,
    `เปลี่ยนเป็นโหมด${lib.GAME_MODE_NAMES[mode]}`,
    [["player", T.PlayerSelector, true]],
    (ctx, who) => {
      for (const p of targets(ctx, who)) lib.setGameMode(p, mode);
    },
    { needPlayer: false, group: "โหมดเกม" }
  );
}

// ===================== เวลา / อากาศ =====================
for (const [key, [time, label]] of Object.entries(lib.TIMES)) {
  command(
    key,
    `ตั้งเวลาเป็น${label}`,
    [],
    (ctx) => {
      world.setTimeOfDay(time);
      lib.tell(ctx.player, `เวลา: §e${label}`);
    },
    { needPlayer: false, group: "เวลา & อากาศ" }
  );
}
for (const [key, [weather, label]] of Object.entries(lib.WEATHERS)) {
  command(
    key,
    `เปลี่ยนอากาศเป็น${label}`,
    [["minutes", T.Integer, true]],
    (ctx, minutes) => {
      const ticks = minutes > 0 ? minutes * 1200 : undefined;
      world.getDimension("overworld").setWeather(weather, ticks);
      lib.tell(ctx.player, `อากาศ: §b${label}` + (ticks ? ` §7(${minutes} นาที)` : ""));
    },
    { needPlayer: false, group: "เวลา & อากาศ" }
  );
}
command(
  "freezetime",
  "หยุดเวลา/ให้เวลาเดินต่อ (on/off)",
  [["cheat:onoff", T.Enum, true]],
  (ctx, value) => {
    const freeze = toggleArg(value, !world.gameRules.doDayLightCycle);
    world.gameRules.doDayLightCycle = !freeze;
    world.gameRules.doWeatherCycle = !freeze;
    lib.tell(ctx.player, freeze ? "§bหยุดเวลาและอากาศแล้ว" : "§aเวลาเดินต่อตามปกติ");
  },
  { needPlayer: false, group: "เวลา & อากาศ" }
);

// ===================== ตัวผู้เล่น =====================
command(
  "heal",
  "ฟื้นเลือดเต็ม + อิ่ม + ดับไฟ",
  [["player", T.PlayerSelector, true]],
  (ctx, who) => {
    for (const p of targets(ctx, who)) {
      lib.heal(p);
      lib.tell(p, "§aฟื้นเลือดเต็มแล้ว");
    }
  },
  { needPlayer: false, group: "ตัวผู้เล่น" }
);
command(
  "feed",
  "เติมความอิ่มเต็ม",
  [["player", T.PlayerSelector, true]],
  (ctx, who) => {
    for (const p of targets(ctx, who)) {
      lib.feed(p);
      lib.tell(p, "§aอิ่มแล้ว");
    }
  },
  { needPlayer: false, group: "ตัวผู้เล่น" }
);
command(
  "god",
  "โหมดอมตะ ไม่ตาย ไม่หิว หายใจใต้น้ำได้ (on/off)",
  [["cheat:onoff", T.Enum, true]],
  (ctx, value) => {
    const on = toggleArg(value, lib.getBuffs(ctx.player).god);
    lib.setBuff(ctx.player, "god", on);
    lib.tell(ctx.player, on ? "§6โหมดอมตะ: เปิด" : "§7โหมดอมตะ: ปิด");
  },
  { group: "ตัวผู้เล่น" }
);
command(
  "nv",
  "มองเห็นในที่มืดถาวร (on/off)",
  [["cheat:onoff", T.Enum, true]],
  (ctx, value) => {
    const on = toggleArg(value, lib.getBuffs(ctx.player).nv);
    lib.setBuff(ctx.player, "nv", on);
    lib.tell(ctx.player, on ? "§eมองในที่มืด: เปิด" : "§7มองในที่มืด: ปิด");
  },
  { group: "ตัวผู้เล่น" }
);
for (const [name, buff, label] of [
  ["speed", "speed", "วิ่งเร็ว"],
  ["haste", "haste", "ขุดไว"],
  ["superjump", "jump", "กระโดดสูง"],
]) {
  command(
    name,
    `${label}ถาวร ระดับ 1-10 (0 = ปิด)`,
    [["level", T.Integer]],
    (ctx, level) => {
      const lv = Math.max(0, Math.min(10, level));
      lib.setBuff(ctx.player, buff, lv);
      lib.tell(ctx.player, lv ? `${label}: §aระดับ ${lv}` : `${label}: §7ปิด`);
    },
    { group: "ตัวผู้เล่น" }
  );
}
command(
  "buffs",
  "ดู/ล้างบัฟถาวรทั้งหมด (off = ปิดทั้งหมด)",
  [["cheat:onoff", T.Enum, true]],
  (ctx, value) => {
    if (value === "off") {
      for (const key of Object.keys(lib.getBuffs(ctx.player))) lib.setBuff(ctx.player, key, false);
    }
    lib.tell(ctx.player, `บัฟที่เปิดอยู่: §a${lib.buffsText(lib.getBuffs(ctx.player))}`);
  },
  { group: "ตัวผู้เล่น" }
);
command(
  "cleareffects",
  "ล้างเอฟเฟกต์ทั้งหมด (ยาพิษ ฯลฯ)",
  [["player", T.PlayerSelector, true]],
  (ctx, who) => {
    for (const p of targets(ctx, who)) {
      lib.clearEffects(p);
      lib.tell(p, "ล้างเอฟเฟกต์แล้ว");
    }
  },
  { needPlayer: false, group: "ตัวผู้เล่น" }
);
command(
  "xp",
  "เพิ่มเลเวล (ใส่ติดลบเพื่อลด)",
  [
    ["levels", T.Integer],
    ["player", T.PlayerSelector, true],
  ],
  (ctx, levels, who) => {
    for (const p of targets(ctx, who)) {
      p.addLevels(levels);
      lib.tell(p, `เลเวลตอนนี้: §a${p.level}`);
    }
  },
  { needPlayer: false, group: "ตัวผู้เล่น" }
);
command(
  "launch",
  "ดีดตัวขึ้นฟ้า (แรง 1-20) ตกลงมาช้า ๆ",
  [["power", T.Float, true]],
  (ctx, power) => lib.launch(ctx.player, Math.max(0.5, Math.min(20, power ?? 3))),
  { group: "ตัวผู้เล่น" }
);

// ===================== ไอเท็ม =====================
command(
  "i",
  "เสกไอเท็ม ใส่จำนวนเกิน 64 ได้ เช่น /i diamond 500",
  [
    ["item", T.ItemType],
    ["amount", T.Integer, true],
    ["player", T.PlayerSelector, true],
  ],
  (ctx, itemType, amount, who) => {
    for (const p of targets(ctx, who)) {
      const n = lib.giveItem(p, itemType.id, amount ?? 1);
      lib.tell(p, `ได้รับ §a${itemType.id.replace("minecraft:", "")} x${n}`);
    }
  },
  { needPlayer: false, group: "ไอเท็ม" }
);
command(
  "kit",
  "รับไอเท็มชุด: " + Object.keys(lib.KITS).join(", "),
  [
    ["cheat:kit", T.Enum],
    ["player", T.PlayerSelector, true],
  ],
  (ctx, kit, who) => {
    for (const p of targets(ctx, who)) {
      lib.giveKit(p, kit);
      lib.tell(p, `ได้รับชุด §a${kit}`);
    }
  },
  { needPlayer: false, group: "ไอเท็ม" }
);
command(
  "repair",
  "ซ่อมของในมือ (all = ซ่อมทั้งกระเป๋า+เกราะ)",
  [["cheat:scope", T.Enum, true]],
  (ctx, scope) => {
    if (scope === "all") {
      lib.tell(ctx.player, `ซ่อมแล้ว §a${lib.repairAll(ctx.player)}§r ชิ้น`);
      return;
    }
    lib.editHeld(ctx.player, (item) => {
      if (!lib.repair(item)) {
        lib.fail(ctx.player, "ไอเท็มนี้ซ่อมไม่ได้ หรือยังไม่เสีย");
        return false;
      }
      lib.tell(ctx.player, "§aซ่อมแล้ว");
    });
  },
  { group: "ไอเท็ม" }
);
command(
  "maxench",
  "เอนชานต์ของในมือ ทุกอย่างที่ใส่ได้ ระดับสูงสุด",
  [],
  (ctx) => {
    lib.editHeld(ctx.player, (item) => {
      const n = lib.maxEnchant(item);
      if (!n) {
        lib.fail(ctx.player, "ไอเท็มนี้เอนชานต์ไม่ได้ หรือเต็มแล้ว");
        return false;
      }
      lib.tell(ctx.player, `§dเอนชานต์แล้ว ${n} อย่าง`);
    });
  },
  { group: "ไอเท็ม" }
);
command(
  "more",
  "เติมของในมือให้เต็มสแต็ก",
  [],
  (ctx) => {
    lib.editHeld(ctx.player, (item) => {
      item.amount = item.maxAmount;
      lib.tell(ctx.player, `เติมเป็น §a${item.maxAmount}§r ชิ้น`);
    });
  },
  { group: "ไอเท็ม" }
);
command(
  "dupe",
  "ก๊อปของในมือ (รวมเอนชานต์/ชื่อ) ได้หลายชุด",
  [["copies", T.Integer, true]],
  (ctx, times) => {
    const n = Math.max(1, Math.min(36, times ?? 1));
    lib.editHeld(ctx.player, (item) => {
      const inv = ctx.player.getComponent("minecraft:inventory").container;
      for (let i = 0; i < n; i++) {
        const rest = inv.addItem(item.clone());
        if (rest) ctx.player.dimension.spawnItem(rest, ctx.player.location);
      }
      lib.tell(ctx.player, `ก๊อปแล้ว §a${n}§r ชุด`);
      return false; // ไม่ต้องแก้ของในมือ
    });
  },
  { group: "ไอเท็ม" }
);
command(
  "rename",
  'ตั้งชื่อของในมือ ใส่สีได้ด้วย & เช่น /rename "&bดาบเทพ"',
  [["name", T.String]],
  (ctx, name) => {
    lib.editHeld(ctx.player, (item) => {
      item.nameTag = name.replace(/&([0-9a-v])/gi, "§$1").slice(0, 64);
      lib.tell(ctx.player, `เปลี่ยนชื่อเป็น ${item.nameTag}`);
    });
  },
  { group: "ไอเท็ม" }
);
command(
  "clearinv",
  "ล้างของในกระเป๋าทั้งหมด (ไม่รวมเกราะ)",
  [["player", T.PlayerSelector, true]],
  (ctx, who) => {
    for (const p of targets(ctx, who)) {
      lib.clearInventory(p);
      lib.tell(p, "ล้างกระเป๋าแล้ว");
    }
  },
  { needPlayer: false, group: "ไอเท็ม" }
);
command(
  "keepinv",
  "ตายแล้วของไม่หาย (on/off)",
  [["cheat:onoff", T.Enum, true]],
  (ctx, value) => {
    const on = toggleArg(value, world.gameRules.keepInventory);
    world.gameRules.keepInventory = on;
    lib.tell(ctx.player, on ? "§aตายแล้วของไม่หาย: เปิด" : "§7ตายแล้วของไม่หาย: ปิด");
  },
  { needPlayer: false, group: "ไอเท็ม" }
);

// ===================== วาร์ป =====================
command(
  "tpto",
  "วาร์ปไปหาผู้เล่น",
  [["player", T.PlayerSelector]],
  (ctx, who) => {
    const target = who.find((p) => p.id !== ctx.player.id);
    if (!target) return lib.fail(ctx.player, "ไม่พบผู้เล่น");
    lib.teleport(ctx.player, target.location, target.dimension);
    lib.tell(ctx.player, `วาร์ปไปหา §a${target.name}`);
  },
  { group: "วาร์ป" }
);
command(
  "bring",
  "ดึงผู้เล่นมาหาเรา",
  [["player", T.PlayerSelector]],
  (ctx, who) => {
    const list = who.filter((p) => p.id !== ctx.player.id);
    for (const p of list) {
      lib.teleport(p, ctx.player.location, ctx.player.dimension);
      lib.tell(p, `§a${ctx.player.name}§r ดึงคุณมา`);
    }
    lib.tell(ctx.player, list.length ? `ดึง §a${names(list)}§r มาแล้ว` : "ไม่พบผู้เล่น");
  },
  { group: "วาร์ป" }
);
command("top", "ขึ้นไปยืนบนสุด (ติดถ้ำก็ออกได้)", [], (ctx) => lib.teleportTop(ctx.player), { group: "วาร์ป" });
command(
  "tplook",
  "วาร์ปไปจุดที่มองอยู่ (ไกลสุด 256 บล็อก)",
  [],
  (ctx) => {
    if (!lib.teleportLook(ctx.player)) lib.fail(ctx.player, "ไม่ได้มองบล็อกใด หรือไกลเกินไป");
  },
  { group: "วาร์ป" }
);
command(
  "spawn",
  "วาร์ปไปจุดเกิดของโลก",
  [],
  (ctx) => {
    const s = world.getDefaultSpawnLocation();
    lib.teleportToSurface(ctx.player, world.getDimension("overworld"), s.x, s.z);
    lib.tell(ctx.player, "วาร์ปไปจุดเกิดโลก");
  },
  { group: "วาร์ป" }
);
command(
  "back",
  "กลับจุดก่อนวาร์ป / จุดที่ตายล่าสุด",
  [],
  (ctx) => {
    if (lib.back(ctx.player)) lib.tell(ctx.player, "กลับจุดก่อนหน้าแล้ว");
    else lib.fail(ctx.player, "ยังไม่มีจุดก่อนหน้า");
  },
  { group: "วาร์ป" }
);
command(
  "sethome",
  `บันทึกบ้านตรงที่ยืน (มีได้ ${lib.MAX_HOMES} หลัง)`,
  [["name", T.String, true]],
  (ctx, raw) => {
    const name = lib.cleanName(raw);
    if (lib.setHome(ctx.player, name)) lib.tell(ctx.player, `บันทึกบ้าน §a${name}§r แล้ว`);
    else lib.fail(ctx.player, `บ้านเต็ม ${lib.MAX_HOMES} หลังแล้ว ลบด้วย /delhome`);
  },
  { group: "วาร์ป" }
);
command(
  "home",
  "วาร์ปกลับบ้าน",
  [["name", T.String, true]],
  (ctx, raw) => {
    const name = lib.cleanName(raw);
    const home = lib.getHomes(ctx.player)[name];
    if (!home) return lib.fail(ctx.player, `ไม่มีบ้านชื่อ ${name} (ดูรายชื่อ /homes)`);
    lib.teleportSaved(ctx.player, home);
    lib.tell(ctx.player, `กลับบ้าน §a${name}`);
  },
  { group: "วาร์ป" }
);
command(
  "delhome",
  "ลบบ้าน",
  [["name", T.String]],
  (ctx, raw) => {
    const name = lib.cleanName(raw);
    if (lib.deleteHome(ctx.player, name)) lib.tell(ctx.player, `ลบบ้าน ${name} แล้ว`);
    else lib.fail(ctx.player, `ไม่มีบ้านชื่อ ${name}`);
  },
  { group: "วาร์ป" }
);
command(
  "homes",
  "ดูรายชื่อบ้านทั้งหมด",
  [],
  (ctx) => {
    const homes = Object.entries(lib.getHomes(ctx.player));
    if (!homes.length) return lib.tell(ctx.player, "ยังไม่มีบ้าน ตั้งด้วย /sethome");
    const lines = homes.map(([n, h]) => `§a${n}§r: ${Math.floor(h.x)}, ${Math.floor(h.y)}, ${Math.floor(h.z)} (${lib.dimensionName(h.d)})`);
    lib.tell(ctx.player, "บ้านของคุณ:\n" + lines.join("\n"));
  },
  { group: "วาร์ป" }
);

// ===================== โลก / พลังพิเศษ =====================
command(
  "butcher",
  "ฆ่ามอนสเตอร์รอบตัว (รัศมี ค่าเริ่ม 64)",
  [["radius", T.Integer, true]],
  (ctx, radius) => {
    const n = lib.butcher(ctx.player, Math.max(1, Math.min(256, radius ?? 64)));
    lib.tell(ctx.player, `กำจัดมอนสเตอร์ §c${n}§r ตัว`);
  },
  { group: "โลก & พลังพิเศษ" }
);
command(
  "smite",
  "เรียกฟ้าผ่าจุดที่มอง หรือใส่ชื่อผู้เล่น",
  [["player", T.PlayerSelector, true]],
  (ctx, who) => {
    if (who?.length) {
      for (const p of who) lib.smite(p.dimension, p.location);
      return;
    }
    const target = lib.lookTarget(ctx.player);
    if (!target) return lib.fail(ctx.player, "ไม่ได้มองอะไรอยู่");
    lib.smite(ctx.player.dimension, target.location);
  },
  { group: "โลก & พลังพิเศษ" }
);
command(
  "boom",
  "ระเบิดจุดที่มอง (แรง 1-20 ค่าเริ่ม 4)",
  [["power", T.Float, true]],
  (ctx, power) => {
    const target = lib.lookTarget(ctx.player);
    if (!target) return lib.fail(ctx.player, "ไม่ได้มองอะไรอยู่");
    lib.explode(ctx.player, target.location, Math.max(1, Math.min(20, power ?? 4)));
  },
  { group: "โลก & พลังพิเศษ" }
);

// ===================== มาโคร / เมนู =====================
command(
  "macro",
  'บันทึก/เรียกมาโคร: /macro เช้า "time set day; weather clear"  แล้วพิมพ์ /macro เช้า',
  [
    ["name", T.String],
    ["commands", T.String, true],
  ],
  (ctx, raw, commands) => {
    const name = lib.cleanName(raw);
    if (commands !== undefined) {
      if (!lib.splitCommands(commands).length) return lib.fail(ctx.player, "ไม่มีคำสั่งในมาโคร");
      lib.setMacro(name, commands);
      lib.tell(ctx.player, `บันทึกมาโคร §a${name}§r แล้ว พิมพ์ /macro ${name} เพื่อใช้`);
      return;
    }
    const saved = lib.getMacros()[name];
    if (!saved) return lib.fail(ctx.player, `ไม่มีมาโครชื่อ ${name} (ดูรายชื่อ /macros)`);
    const [ok, total] = lib.runCommands(ctx.player, saved);
    lib.tell(ctx.player, `มาโคร ${name}: สำเร็จ §a${ok}/${total}`);
  },
  { group: "มาโคร & เมนู" }
);
command(
  "run",
  'รันหลายคำสั่งในบรรทัดเดียว คั่นด้วย ; เช่น /run "gmc; day; heal"',
  [["commands", T.String]],
  (ctx, commands) => {
    const [ok, total] = lib.runCommands(ctx.player, commands);
    lib.tell(ctx.player, `สำเร็จ §a${ok}/${total}`);
  },
  { group: "มาโคร & เมนู" }
);
command(
  "delmacro",
  "ลบมาโคร",
  [["name", T.String]],
  (ctx, raw) => {
    const name = lib.cleanName(raw);
    if (!(name in lib.getMacros())) return lib.fail(ctx.player, `ไม่มีมาโครชื่อ ${name}`);
    lib.setMacro(name, undefined);
    lib.tell(ctx.player, `ลบมาโคร ${name} แล้ว`);
  },
  { needPlayer: false, group: "มาโคร & เมนู" }
);
command(
  "macros",
  "ดูรายชื่อมาโครทั้งหมด",
  [],
  (ctx) => {
    const macros = Object.entries(lib.getMacros());
    if (!macros.length) return lib.tell(ctx.player, 'ยังไม่มีมาโคร สร้างด้วย /macro ชื่อ "คำสั่ง1; คำสั่ง2"');
    lib.tell(ctx.player, "มาโคร:\n" + macros.map(([n, c]) => `§a${n}§r: ${c}`).join("\n"));
  },
  { group: "มาโคร & เมนู" }
);
command("menu", "เปิดเมนูโกงแบบกดปุ่ม (ไม่ต้องพิมพ์)", [], (ctx) => openMenu(ctx.player), { group: "มาโคร & เมนู" });
command(
  "wand",
  "รับไม้เมนูโกง กดใช้เมื่อไหร่ก็เปิดเมนู",
  [],
  (ctx) => {
    lib.giveWand(ctx.player);
    lib.tell(ctx.player, "ได้รับ §dไม้เมนูโกง§r ถือแล้วแตะค้าง/คลิกขวาเพื่อเปิดเมนู");
  },
  { group: "มาโคร & เมนู" }
);
command(
  "cmds",
  "ดูคำสั่งทั้งหมดของ Easy Cheats",
  [],
  (ctx) => lib.tell(ctx.player, helpText()),
  { needPlayer: false, group: "มาโคร & เมนู" }
);

// ===================== ลงทะเบียน =====================
export function helpText() {
  const groups = new Map();
  for (const cmd of COMMANDS) {
    if (!groups.has(cmd.group)) groups.set(cmd.group, []);
    groups.get(cmd.group).push(`§e${usage(cmd)}§r - ${cmd.help}`);
  }
  let text = "§lคำสั่งทั้งหมด§r (ถ้าชนกับ addon อื่น ให้พิมพ์ /cheat:ชื่อคำสั่ง)";
  for (const [group, lines] of groups) text += `\n§6— ${group} —§r\n` + lines.join("\n");
  return text;
}

export function registerCommands(registry) {
  registry.registerEnum(`${NS}:onoff`, ["on", "off"]);
  registry.registerEnum(`${NS}:kit`, Object.keys(lib.KITS));
  registry.registerEnum(`${NS}:scope`, ["hand", "all"]);

  for (const cmd of COMMANDS) {
    const mandatory = [];
    const optional = [];
    for (const [name, type, isOptional] of cmd.args) (isOptional ? optional : mandatory).push({ name, type });
    registry.registerCommand(
      {
        name: `${NS}:${cmd.name}`,
        description: cmd.help,
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: true, // ใช้ได้เฉพาะโลกที่เปิดโกง
        mandatoryParameters: mandatory,
        optionalParameters: optional,
      },
      (origin, ...args) => {
        const player = sourcePlayer(origin);
        if (cmd.needPlayer && !player) {
          return { status: CustomCommandStatus.Failure, message: "คำสั่งนี้ต้องใช้โดยผู้เล่น" };
        }
        // callback นี้อยู่ในโหมดอ่านอย่างเดียว ต้องเลื่อนไปทำใน tick ถัดไป
        system.run(() => {
          try {
            cmd.run({ player, origin }, ...args);
          } catch (e) {
            lib.fail(player, `ผิดพลาด: ${e?.message ?? e}`);
          }
        });
        return { status: CustomCommandStatus.Success };
      }
    );
  }
}

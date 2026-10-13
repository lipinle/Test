import { system, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus } from "@minecraft/server";
import { getData, resetData } from "./data.js";
import { maxMana, setLevel } from "./progression.js";
import { openGrimoire, giveKit, maxOut } from "./ui.js";
import { startBloodMoon, stopBloodMoon } from "./events.js";
import { openRift, forceCollapseAll } from "./rifts.js";
import { tell } from "./util.js";

// คำสั่ง /arc:... (Custom Commands ของ Script API) + /scriptevent arc:<ชื่อ> สำหรับเวอร์ชันที่ไม่มี
const ok = (message) => ({ status: CustomCommandStatus.Success, message });
const fail = (message) => ({ status: CustomCommandStatus.Failure, message });

function playerOf(origin) {
  const e = origin.sourceEntity ?? origin.initiator;
  return e?.typeId === "minecraft:player" ? e : undefined;
}

function spawnAhead(player, type) {
  const dir = player.getViewDirection();
  player.dimension.spawnEntity(type, { x: player.location.x + dir.x * 8, y: player.location.y, z: player.location.z + dir.z * 8 });
}

export const ACTIONS = {
  menu: (p) => openGrimoire(p),
  stats: (p) => {
    const d = getData(p);
    tell(p, `§d[Arcane] §fLv ${d.lvl} • XP ${d.xp} • มานา ${Math.floor(d.mana)}/${maxMana(p, d)} • INT ${d.attr.int} WIS ${d.attr.wis} VIT ${d.attr.vit} CEL ${d.attr.cel} • คาถา ${d.known.length}/12`);
  },
  kit: (p) => giveKit(p),
  max: (p) => maxOut(p),
  bloodmoon: (p, arg) => (arg === "off" ? stopBloodMoon() : startBloodMoon()),
  boss: (p, arg) => spawnAhead(p, arg === "void_titan" ? "arc:void_titan" : "arc:ember_colossus"),
  rift: (p, arg) => openRift(p, Math.max(1, Math.min(3, Number(arg) || 1))),
  riftclose: () => forceCollapseAll(),
  reset: (p) => resetData(p),
  setlevel: (p, arg) => setLevel(p, Number(arg) || 1),
};

export function registerCommands(reg) {
  reg.registerEnum("arc:boss_type", ["ember_colossus", "void_titan"]);
  reg.registerEnum("arc:toggle", ["on", "off"]);
  const run = (name, arg) => (origin) => {
    const p = playerOf(origin);
    if (!p) return fail("ต้องใช้โดยผู้เล่น");
    system.run(() => ACTIONS[name](p, arg));
    return ok();
  };
  reg.registerCommand(
    { name: "arc:menu", description: "เปิดคัมภีร์เวท Arcane Ascension", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    run("menu"),
  );
  reg.registerCommand(
    { name: "arc:stats", description: "ดูค่าสถานะเวทของตัวเอง", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    run("stats"),
  );
  reg.registerCommand(
    { name: "arc:kit", description: "[OP] รับไอเท็มทดสอบครบชุด", permissionLevel: CommandPermissionLevel.GameDirectors },
    run("kit"),
  );
  reg.registerCommand(
    { name: "arc:max", description: "[OP] เลเวลสูงสุด + เรียนทุกคาถา", permissionLevel: CommandPermissionLevel.GameDirectors },
    run("max"),
  );
  reg.registerCommand(
    {
      name: "arc:setlevel", description: "[OP] ตั้งเลเวลเวท", permissionLevel: CommandPermissionLevel.GameDirectors,
      mandatoryParameters: [{ name: "level", type: CustomCommandParamType.Integer }],
    },
    (origin, level) => run("setlevel", level)(origin),
  );
  reg.registerCommand(
    {
      name: "arc:bloodmoon", description: "[OP] เริ่ม/หยุดจันทร์สีเลือด", permissionLevel: CommandPermissionLevel.GameDirectors,
      mandatoryParameters: [{ name: "arc:toggle", type: CustomCommandParamType.Enum }],
    },
    (origin, v) => run("bloodmoon", v)(origin),
  );
  reg.registerCommand(
    {
      name: "arc:boss", description: "[OP] อัญเชิญบอสตรงหน้า", permissionLevel: CommandPermissionLevel.GameDirectors,
      mandatoryParameters: [{ name: "arc:boss_type", type: CustomCommandParamType.Enum }],
    },
    (origin, v) => run("boss", v)(origin),
  );
  reg.registerCommand(
    {
      name: "arc:rift", description: "[OP] เปิดรอยแยกมิติทันที (ระดับ 1-3)", permissionLevel: CommandPermissionLevel.GameDirectors,
      mandatoryParameters: [{ name: "tier", type: CustomCommandParamType.Integer }],
    },
    (origin, tier) => run("rift", tier)(origin),
  );
  reg.registerCommand(
    { name: "arc:riftclose", description: "[OP] ปิดรอยแยกทั้งหมด", permissionLevel: CommandPermissionLevel.GameDirectors },
    run("riftclose"),
  );
  reg.registerCommand(
    { name: "arc:reset", description: "[OP] รีเซ็ตข้อมูลเวทของตัวเอง", permissionLevel: CommandPermissionLevel.GameDirectors },
    run("reset"),
  );
}

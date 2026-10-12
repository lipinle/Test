import { world, system, GameMode, CommandPermissionLevel, PlayerPermissionLevel } from "@minecraft/server";
import { ActionFormData, ModalFormData, FormCancelationReason } from "@minecraft/server-ui";
import * as lib from "./lib.js";
import { helpText } from "./commands.js";

// ไอเท็มยอดนิยมในเมนูเสกไอเท็ม
const POPULAR_ITEMS = [
  "diamond",
  "netherite_ingot",
  "iron_ingot",
  "gold_ingot",
  "emerald",
  "enchanted_golden_apple",
  "golden_apple",
  "totem_of_undying",
  "elytra",
  "firework_rocket",
  "ender_pearl",
  "experience_bottle",
  "tnt",
  "beacon",
  "shulker_box",
  "diamond_block",
  "golden_carrot",
  "torch",
  "cooked_beef",
];

// กฎของโลกที่แก้ได้ในเมนู
const GAME_RULES = [
  ["keepInventory", "ตายแล้วของไม่หาย"],
  ["doDayLightCycle", "เวลาเดิน"],
  ["doWeatherCycle", "อากาศเปลี่ยน"],
  ["doMobSpawning", "มอนเกิด"],
  ["mobGriefing", "มอนทำลายบล็อก (ครีปเปอร์ระเบิด)"],
  ["doFireTick", "ไฟลาม"],
  ["fallDamage", "ตกแล้วเจ็บ"],
  ["drowningDamage", "จมน้ำแล้วเจ็บ"],
  ["fireDamage", "ไฟลวกแล้วเจ็บ"],
  ["naturalRegeneration", "เลือดฟื้นเอง"],
  ["pvp", "ผู้เล่นตีกันได้"],
  ["doImmediateRespawn", "เกิดใหม่ทันที"],
  ["doInsomnia", "แฟนทอมเกิด"],
  ["showCoordinates", "แสดงพิกัด"],
  ["showDaysPlayed", "แสดงจำนวนวัน"],
  ["tntExplodes", "TNT ระเบิด"],
];

function icon(name) {
  return `textures/items/${name}`;
}

// แสดงฟอร์ม ถ้าผู้เล่นยังเปิดแชทอยู่ (เพิ่งพิมพ์ /menu) ให้รอจนปิดแชท
async function show(player, form) {
  for (let i = 0; i < 100; i++) {
    const response = await form.show(player);
    if (response.cancelationReason !== FormCancelationReason.UserBusy) return response;
    await system.waitTicks(5);
  }
  return undefined;
}

/**
 * เมนูปุ่มกด
 * @param {any} player
 * @param {string} title
 * @param {string} body
 * @param {{text: string, icon?: string, run: () => any}[]} items
 * @param {() => any} [back]
 */
async function buttons(player, title, body, items, back) {
  const form = new ActionFormData().title(title).body(body);
  for (const item of items) form.button(item.text, item.icon);
  if (back) form.button("§l< กลับ", icon("arrow"));
  const response = await show(player, form);
  if (!response || response.canceled || response.selection === undefined) return;
  const choice = items[response.selection];
  if (!choice) return back?.();
  try {
    await choice.run();
  } catch (e) {
    lib.fail(player, `ผิดพลาด: ${e?.message ?? e}`);
  }
}

// ทำแล้วกลับไปเมนูเดิม เพื่อกดต่อได้เร็ว ๆ
function andThen(action, menu) {
  return async () => {
    await action();
    await menu();
  };
}

export function openMenu(player) {
  const allowed = player.playerPermissionLevel === PlayerPermissionLevel.Operator || player.commandPermissionLevel >= CommandPermissionLevel.GameDirectors;
  if (!allowed) {
    lib.fail(player, "ต้องเป็นผู้ดูแล (Operator) จึงใช้เมนูโกงได้");
    return;
  }
  mainMenu(player).catch((e) => lib.fail(player, `ผิดพลาด: ${e?.message ?? e}`));
}

async function mainMenu(player) {
  const buffs = lib.getBuffs(player);
  const mode = lib.GAME_MODE_NAMES[player.getGameMode()];
  await buttons(player, "§l§6Easy Cheats", `โหมด: §a${mode}§r\nบัฟ: §a${lib.buffsText(buffs)}`, [
    { text: "โหมดเกม", icon: icon("totem"), run: () => gameModeMenu(player) },
    { text: "เวลา & อากาศ", icon: icon("clock_item"), run: () => timeMenu(player) },
    { text: "ตัวผู้เล่น", icon: icon("apple_golden"), run: () => playerMenu(player) },
    { text: "วาร์ป", icon: icon("ender_pearl"), run: () => teleportMenu(player) },
    { text: "ไอเท็ม", icon: icon("diamond"), run: () => itemMenu(player) },
    { text: "โลก & พลังพิเศษ", icon: icon("fireball"), run: () => worldMenu(player) },
    { text: "พิมพ์คำสั่ง (หลายคำสั่งได้)", icon: icon("book_writable"), run: () => commandForm(player) },
    { text: "มาโคร", icon: icon("book_enchanted"), run: () => macroMenu(player) },
    { text: "คู่มือคำสั่ง", icon: icon("book_normal"), run: () => helpMenu(player) },
  ]);
}

async function gameModeMenu(player) {
  const set = (mode) => () => lib.setGameMode(player, mode);
  await buttons(
    player,
    "โหมดเกม",
    "พิมพ์ลัด: /gmc /gms /gma /gmsp",
    [
      { text: "สร้างสรรค์ (Creative)", icon: icon("diamond_pickaxe"), run: set(GameMode.Creative) },
      { text: "เอาชีวิตรอด (Survival)", icon: icon("iron_sword"), run: set(GameMode.Survival) },
      { text: "ผจญภัย (Adventure)", icon: icon("map_filled"), run: set(GameMode.Adventure) },
      { text: "ผู้ชม (Spectator)", icon: icon("ender_eye"), run: set(GameMode.Spectator) },
    ],
    () => mainMenu(player)
  );
}

async function timeMenu(player) {
  const again = () => timeMenu(player);
  const items = [];
  for (const [key, [time, label]] of Object.entries(lib.TIMES)) {
    items.push({ text: `${label}  §8/${key}`, icon: icon("clock_item"), run: andThen(() => world.setTimeOfDay(time), again) });
  }
  for (const [key, [weather, label]] of Object.entries(lib.WEATHERS)) {
    items.push({
      text: `${label}  §8/${key}`,
      icon: icon(key === "sun" ? "glowstone_dust" : "bucket_water"),
      run: andThen(() => world.getDimension("overworld").setWeather(weather), again),
    });
  }
  const frozen = !world.gameRules.doDayLightCycle;
  items.push({
    text: frozen ? "§aให้เวลาเดินต่อ" : "§bหยุดเวลา & อากาศ",
    icon: icon("snowball"),
    run: andThen(() => {
      world.gameRules.doDayLightCycle = frozen;
      world.gameRules.doWeatherCycle = frozen;
    }, again),
  });
  await buttons(player, "เวลา & อากาศ", `เวลาในเกม: ${world.getTimeOfDay()}`, items, () => mainMenu(player));
}

async function playerMenu(player) {
  const again = () => playerMenu(player);
  const buffs = lib.getBuffs(player);
  const onOff = (v) => (v ? "§a[เปิด]" : "§7[ปิด]");
  await buttons(
    player,
    "ตัวผู้เล่น",
    `บัฟ: §a${lib.buffsText(buffs)}`,
    [
      { text: "ฟื้นเลือด + อิ่ม  §8/heal", icon: icon("apple_golden"), run: andThen(() => lib.heal(player), again) },
      { text: `อมตะ ${onOff(buffs.god)}  §8/god`, icon: icon("totem"), run: andThen(() => lib.setBuff(player, "god", !buffs.god), again) },
      { text: `มองในที่มืด ${onOff(buffs.nv)}  §8/nv`, icon: icon("carrot_golden"), run: andThen(() => lib.setBuff(player, "nv", !buffs.nv), again) },
      { text: "ปรับบัฟ วิ่ง/ขุด/กระโดด", icon: icon("sugar"), run: () => buffForm(player) },
      { text: "เพิ่มเลเวล XP", icon: icon("experience_bottle"), run: () => xpForm(player) },
      { text: "ล้างเอฟเฟกต์  §8/cleareffects", icon: icon("bucket_milk"), run: andThen(() => lib.clearEffects(player), again) },
      { text: "ดีดตัวขึ้นฟ้า  §8/launch", icon: icon("fireworks"), run: () => lib.launch(player, 4) },
    ],
    () => mainMenu(player)
  );
}

async function buffForm(player) {
  const buffs = lib.getBuffs(player);
  const form = new ModalFormData()
    .title("บัฟถาวร (0 = ปิด)")
    .slider("วิ่งเร็ว", 0, 10, { valueStep: 1, defaultValue: buffs.speed ?? 0 })
    .slider("ขุดไว", 0, 10, { valueStep: 1, defaultValue: buffs.haste ?? 0 })
    .slider("กระโดดสูง", 0, 10, { valueStep: 1, defaultValue: buffs.jump ?? 0 })
    .submitButton("ตกลง");
  const response = await show(player, form);
  if (!response?.formValues) return playerMenu(player);
  const [speed, haste, jump] = response.formValues;
  lib.setBuff(player, "speed", speed);
  lib.setBuff(player, "haste", haste);
  lib.setBuff(player, "jump", jump);
  lib.tell(player, `บัฟ: §a${lib.buffsText(lib.getBuffs(player))}`);
  await playerMenu(player);
}

async function xpForm(player) {
  const form = new ModalFormData()
    .title("เพิ่มเลเวล XP")
    .slider("เลเวล", 1, 100, { valueStep: 1, defaultValue: 30 })
    .submitButton("เพิ่ม");
  const response = await show(player, form);
  if (response?.formValues) {
    player.addLevels(Number(response.formValues[0]));
    lib.tell(player, `เลเวลตอนนี้: §a${player.level}`);
  }
  await playerMenu(player);
}

async function teleportMenu(player) {
  const again = () => teleportMenu(player);
  const others = world.getPlayers().filter((p) => p.id !== player.id);
  await buttons(
    player,
    "วาร์ป",
    "",
    [
      { text: "ขึ้นไปบนสุด  §8/top", icon: icon("feather"), run: () => lib.teleportTop(player) },
      {
        text: "ไปจุดที่มองอยู่  §8/tplook",
        icon: icon("ender_eye"),
        run: () => lib.teleportLook(player) || lib.fail(player, "ไม่ได้มองบล็อกใด หรือไกลเกินไป"),
      },
      { text: "จุดเกิดโลก  §8/spawn", icon: icon("compass_item"), run: () => spawn(player) },
      { text: "กลับจุดก่อนหน้า / จุดตาย  §8/back", icon: icon("compass_item"), run: () => lib.back(player) || lib.fail(player, "ยังไม่มีจุดก่อนหน้า") },
      { text: "บ้านของฉัน", icon: icon("bed_red"), run: () => homeMenu(player) },
      ...(others.length
        ? [
            { text: "ไปหาผู้เล่น", icon: icon("ender_pearl"), run: () => playerPicker(player, "ไปหาผู้เล่น", (p) => lib.teleport(player, p.location, p.dimension), again) },
            { text: "ดึงผู้เล่นมาหาเรา", icon: icon("lead"), run: () => playerPicker(player, "ดึงผู้เล่นมา", (p) => lib.teleport(p, player.location, player.dimension), again) },
          ]
        : []),
    ],
    () => mainMenu(player)
  );
}

function spawn(player) {
  const s = world.getDefaultSpawnLocation();
  lib.teleportToSurface(player, world.getDimension("overworld"), s.x, s.z);
}

async function playerPicker(player, title, action, back) {
  const others = world.getPlayers().filter((p) => p.id !== player.id);
  await buttons(
    player,
    title,
    "",
    others.map((p) => ({ text: p.name, run: () => action(p) })),
    back
  );
}

async function homeMenu(player) {
  const again = () => homeMenu(player);
  const homes = Object.entries(lib.getHomes(player));
  await buttons(
    player,
    "บ้านของฉัน",
    homes.length ? "แตะชื่อบ้านเพื่อวาร์ป" : "ยังไม่มีบ้าน กด \"ตั้งบ้านตรงนี้\"",
    [
      { text: "§2+ ตั้งบ้านตรงนี้", icon: icon("bed_red"), run: () => setHomeForm(player) },
      ...homes.map(([name, h]) => ({
        text: `${name}\n§8${Math.floor(h.x)}, ${Math.floor(h.y)}, ${Math.floor(h.z)} ${lib.dimensionName(h.d)}`,
        run: () => lib.teleportSaved(player, h),
      })),
      ...(homes.length ? [{ text: "§c- ลบบ้าน", icon: "textures/blocks/barrier", run: () => deleteHomeMenu(player) }] : []),
    ],
    () => teleportMenu(player)
  );
}

async function setHomeForm(player) {
  const form = new ModalFormData().title("ตั้งบ้าน").textField("ชื่อบ้าน", "home", { defaultValue: "home" }).submitButton("บันทึก");
  const response = await show(player, form);
  if (response?.formValues) {
    const name = lib.cleanName(response.formValues[0]);
    if (lib.setHome(player, name)) lib.tell(player, `บันทึกบ้าน §a${name}§r แล้ว`);
    else lib.fail(player, `บ้านเต็ม ${lib.MAX_HOMES} หลังแล้ว`);
  }
  await homeMenu(player);
}

async function deleteHomeMenu(player) {
  const homes = Object.keys(lib.getHomes(player));
  await buttons(
    player,
    "§cลบบ้าน",
    "แตะชื่อบ้านที่จะลบ",
    homes.map((name) => ({ text: `§c${name}`, run: andThen(() => lib.deleteHome(player, name), () => homeMenu(player)) })),
    () => homeMenu(player)
  );
}

async function itemMenu(player) {
  const again = () => itemMenu(player);
  await buttons(
    player,
    "ไอเท็ม",
    "",
    [
      { text: "เสกไอเท็ม  §8/i", icon: icon("diamond"), run: () => giveForm(player) },
      { text: "ไอเท็มชุด  §8/kit", icon: icon("chest_minecart"), run: () => kitMenu(player) },
      { text: "ซ่อมของในมือ  §8/repair", icon: icon("iron_ingot"), run: andThen(() => repairHeld(player), again) },
      { text: "ซ่อมทุกชิ้น  §8/repair all", icon: icon("iron_ingot"), run: andThen(() => lib.tell(player, `ซ่อมแล้ว ${lib.repairAll(player)} ชิ้น`), again) },
      { text: "เอนชานต์สูงสุด  §8/maxench", icon: icon("book_enchanted"), run: andThen(() => enchantHeld(player), again) },
      { text: "เติมจนเต็มสแต็ก  §8/more", icon: icon("emerald"), run: andThen(() => lib.editHeld(player, (i) => void (i.amount = i.maxAmount)), again) },
      { text: "ก๊อปของในมือ  §8/dupe", icon: icon("paper"), run: andThen(() => dupeHeld(player), again) },
      { text: "ตั้งชื่อของในมือ  §8/rename", icon: icon("name_tag"), run: () => renameForm(player) },
      { text: "§cล้างกระเป๋า  §8/clearinv", icon: icon("bucket_lava"), run: () => confirmClear(player) },
      { text: "รับไม้เมนูโกง  §8/wand", icon: icon("stick"), run: () => lib.giveWand(player) },
    ],
    () => mainMenu(player)
  );
}

function repairHeld(player) {
  lib.editHeld(player, (item) => (lib.repair(item) ? item : (lib.fail(player, "ไอเท็มนี้ซ่อมไม่ได้ หรือยังไม่เสีย"), false)));
}

function enchantHeld(player) {
  lib.editHeld(player, (item) => {
    const n = lib.maxEnchant(item);
    if (!n) {
      lib.fail(player, "ไอเท็มนี้เอนชานต์ไม่ได้ หรือเต็มแล้ว");
      return false;
    }
    lib.tell(player, `§dเอนชานต์แล้ว ${n} อย่าง`);
  });
}

function dupeHeld(player) {
  lib.editHeld(player, (item) => {
    const rest = player.getComponent("minecraft:inventory").container.addItem(item.clone());
    if (rest) player.dimension.spawnItem(rest, player.location);
    return false;
  });
}

async function giveForm(player) {
  const form = new ModalFormData()
    .title("เสกไอเท็ม")
    .dropdown("เลือกไอเท็มยอดนิยม", ["— พิมพ์เองด้านล่าง —", ...POPULAR_ITEMS], { defaultValueIndex: 0 })
    .textField("หรือพิมพ์ชื่อไอเท็ม (ไม่ต้องมี minecraft:)", "เช่น diamond_sword")
    .slider("จำนวน (สแต็ก x64 ใช้ช่องล่าง)", 1, 64, { valueStep: 1, defaultValue: 1 })
    .textField("จำนวนมาก ๆ (ถ้าใส่จะใช้ค่านี้แทน)", "เช่น 500")
    .submitButton("เสก");
  const response = await show(player, form);
  if (!response?.formValues) return itemMenu(player);
  const [index, typed, slider, bigAmount] = response.formValues;
  const name = String(typed).trim() || (index > 0 ? POPULAR_ITEMS[index - 1] : "");
  if (!name) {
    lib.fail(player, "ยังไม่ได้เลือกไอเท็ม");
    return giveForm(player);
  }
  const id = name.includes(":") ? name : `minecraft:${name.toLowerCase().replace(/\s+/g, "_")}`;
  const amount = Number(bigAmount) > 0 ? Number(bigAmount) : Number(slider);
  try {
    const n = lib.giveItem(player, id, amount);
    lib.tell(player, `ได้รับ §a${id.replace("minecraft:", "")} x${n}`);
  } catch {
    lib.fail(player, `ไม่มีไอเท็มชื่อ ${id}`);
  }
  await itemMenu(player);
}

async function kitMenu(player) {
  await buttons(
    player,
    "ไอเท็มชุด",
    "ชุด tools/armor/combat/flying เอนชานต์สูงสุดมาให้แล้ว",
    Object.keys(lib.KITS).map((kit) => ({
      text: `${kit}\n§8${lib.KITS[kit].length} อย่าง`,
      run: andThen(() => {
        lib.giveKit(player, kit);
        lib.tell(player, `ได้รับชุด §a${kit}`);
      }, () => kitMenu(player)),
    })),
    () => itemMenu(player)
  );
}

async function renameForm(player) {
  const form = new ModalFormData().title("ตั้งชื่อของในมือ").textField("ชื่อใหม่ (ใส่สีด้วย &a &b &c ...)", "&bดาบเทพ").submitButton("ตั้งชื่อ");
  const response = await show(player, form);
  if (response?.formValues) {
    const name = String(response.formValues[0]).replace(/&([0-9a-v])/gi, "§$1").slice(0, 64);
    if (name) lib.editHeld(player, (item) => void (item.nameTag = name));
  }
  await itemMenu(player);
}

async function confirmClear(player) {
  await buttons(
    player,
    "§cล้างกระเป๋า?",
    "ของในกระเป๋าทั้งหมดจะหายไป (เกราะที่ใส่อยู่ไม่หาย)",
    [{ text: "§cล้างเลย", run: () => lib.clearInventory(player) }],
    () => itemMenu(player)
  );
}

async function worldMenu(player) {
  const again = () => worldMenu(player);
  await buttons(
    player,
    "โลก & พลังพิเศษ",
    "",
    [
      { text: "ฆ่ามอนรอบตัว 64 บล็อก  §8/butcher", icon: icon("diamond_sword"), run: andThen(() => lib.tell(player, `กำจัด ${lib.butcher(player, 64)} ตัว`), again) },
      {
        text: "ฟ้าผ่าจุดที่มอง  §8/smite",
        icon: icon("trident"),
        run: () => {
          const t = lib.lookTarget(player);
          if (t) lib.smite(player.dimension, t.location);
          else lib.fail(player, "ไม่ได้มองอะไรอยู่");
        },
      },
      {
        text: "ระเบิดจุดที่มอง  §8/boom",
        icon: icon("fireball"),
        run: () => {
          const t = lib.lookTarget(player);
          if (t) lib.explode(player, t.location, 4);
          else lib.fail(player, "ไม่ได้มองอะไรอยู่");
        },
      },
      { text: "กฎของโลก (Game Rules)", icon: icon("map_empty"), run: () => gameRuleForm(player) },
    ],
    () => mainMenu(player)
  );
}

async function gameRuleForm(player) {
  const rules = world.gameRules;
  const available = GAME_RULES.filter(([key]) => typeof rules[key] === "boolean");
  const form = new ModalFormData().title("กฎของโลก");
  for (const [key, label] of available) form.toggle(label, { defaultValue: rules[key] });
  form.submitButton("บันทึก");
  const response = await show(player, form);
  if (response?.formValues) {
    let changed = 0;
    available.forEach(([key], i) => {
      const value = Boolean(response.formValues[i]);
      if (rules[key] !== value) {
        rules[key] = value;
        changed++;
      }
    });
    lib.tell(player, `เปลี่ยนกฎ §a${changed}§r ข้อ`);
  }
  await worldMenu(player);
}

async function commandForm(player, prefill = "") {
  const history = lib.getHistory(player);
  const form = new ModalFormData()
    .title("พิมพ์คำสั่ง")
    .textField("คำสั่ง (ไม่ต้องใส่ /, หลายคำสั่งคั่นด้วย ;)", "เช่น gmc; day; heal", { defaultValue: prefill })
    .dropdown("หรือเลือกคำสั่งที่เคยใช้", ["— ไม่เลือก —", ...history], { defaultValueIndex: 0 })
    .toggle("บันทึกเป็นมาโครด้วย")
    .textField("ชื่อมาโคร", "เช่น เช้า")
    .submitButton("รัน");
  const response = await show(player, form);
  if (!response?.formValues) return mainMenu(player);
  const [typed, historyIndex, save, macroName] = response.formValues;
  const text = String(typed).trim() || (historyIndex > 0 ? history[historyIndex - 1] : "");
  if (!text) return commandForm(player);
  lib.pushHistory(player, text);
  if (save) {
    const name = lib.cleanName(macroName, "");
    if (name) {
      lib.setMacro(name, text);
      lib.tell(player, `บันทึกมาโคร §a${name}§r แล้ว พิมพ์ /macro ${name}`);
    } else lib.fail(player, "ยังไม่ได้ตั้งชื่อมาโคร");
  }
  const [ok, total] = lib.runCommands(player, text);
  lib.tell(player, `สำเร็จ §a${ok}/${total}`);
}

async function macroMenu(player) {
  const macros = Object.entries(lib.getMacros());
  await buttons(
    player,
    "มาโคร",
    macros.length ? "แตะเพื่อรัน" : "ยังไม่มีมาโคร",
    [
      { text: "§2+ สร้างมาโครใหม่", icon: icon("book_writable"), run: () => newMacroForm(player) },
      ...macros.map(([name, commands]) => ({
        text: `${name}\n§8${commands.slice(0, 40)}`,
        run: () => {
          const [ok, total] = lib.runCommands(player, commands);
          lib.tell(player, `มาโคร ${name}: สำเร็จ §a${ok}/${total}`);
        },
      })),
      ...(macros.length ? [{ text: "§c- ลบมาโคร", icon: "textures/blocks/barrier", run: () => deleteMacroMenu(player) }] : []),
    ],
    () => mainMenu(player)
  );
}

async function newMacroForm(player) {
  const form = new ModalFormData()
    .title("สร้างมาโคร")
    .textField("ชื่อ", "เช่น เช้า")
    .textField("คำสั่ง คั่นด้วย ;", "เช่น time set day; weather clear; heal")
    .submitButton("บันทึก");
  const response = await show(player, form);
  if (response?.formValues) {
    const name = lib.cleanName(response.formValues[0], "");
    const commands = String(response.formValues[1]);
    if (name && lib.splitCommands(commands).length) {
      lib.setMacro(name, commands);
      lib.tell(player, `บันทึกมาโคร §a${name}§r แล้ว พิมพ์ /macro ${name}`);
    } else lib.fail(player, "ต้องใส่ทั้งชื่อและคำสั่ง");
  }
  await macroMenu(player);
}

async function deleteMacroMenu(player) {
  await buttons(
    player,
    "§cลบมาโคร",
    "แตะชื่อมาโครที่จะลบ",
    Object.keys(lib.getMacros()).map((name) => ({ text: `§c${name}`, run: andThen(() => lib.setMacro(name, undefined), () => macroMenu(player)) })),
    () => macroMenu(player)
  );
}

async function helpMenu(player) {
  await buttons(player, "คู่มือคำสั่ง", helpText(), [], () => mainMenu(player));
}

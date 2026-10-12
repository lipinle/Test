// เมนูทั้งหมด (เปิดด้วยสมุดสถานะ)

import { system, world } from "@minecraft/server";
import { ActionFormData, FormCancelationReason, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import {
  MAX_LEVEL,
  MAX_PROF_LEVEL,
  MAX_STAT,
  PROFS,
  PROF_IDS,
  RESET_COST_LEVELS,
  SKILLS,
  STATS,
  STAT_IDS,
  magnetRange,
  profXpToNext,
  rankOf,
  statFx,
  treeLimit,
  veinLimit,
  xpToNext,
} from "./config.js";
import { getData, getWorld, isAdmin, resetData, saveNow, saveWorld } from "./data.js";
import { progressBar, setLevel, totalPointsAt, updateNameTag } from "./progression.js";
import { isCreative } from "./util.js";

const pct = (v) => `${Math.round(v * 1000) / 10}%`;

/** แสดงฟอร์ม — ถ้าผู้เล่นยังเปิดแชท/หน้าจออื่นอยู่ จะรอแล้วลองใหม่ */
async function show(player, form) {
  for (let i = 0; i < 20; i++) {
    const res = await form.show(player);
    if (res.cancelationReason !== FormCancelationReason.UserBusy) return res;
    await new Promise((resolve) => system.runTimeout(() => resolve(undefined), 10));
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// หน้าหลัก
// ---------------------------------------------------------------------------

export async function openMain(player) {
  const d = getData(player);
  const need = xpToNext(d.level);
  const xpLine =
    d.level >= MAX_LEVEL ? "§6เลเวลสูงสุดแล้ว!" : `${progressBar(d.xp, need, 30)} §f${d.xp}/${need}`;
  const unlocked = SKILLS.filter((s) => d.level >= s.level).length;

  const buttons = [
    { text: "ข้อมูลตัวละคร", icon: "textures/items/book_written", run: openProfile },
    { text: `อัพค่าสถานะ\n§2แต้มคงเหลือ ${d.points}`, icon: "textures/items/experience_bottle", run: openStats },
    { text: "ความชำนาญอาวุธ/อุปกรณ์", icon: "textures/items/diamond_sword", run: openProfs },
    { text: `สกิลพิเศษ (เปิด/ปิด)\n§5ปลดล็อกแล้ว ${unlocked}/${SKILLS.length}`, icon: "textures/items/nether_star", run: openSkills },
    { text: "ตั้งค่า", icon: "textures/items/redstone_dust", run: openSettings },
    { text: "วิธีเล่น", icon: "textures/items/book_normal", run: openHelp },
  ];
  if (isAdmin(player)) buttons.push({ text: "§4ผู้ดูแลโลก", icon: "textures/items/comparator", run: openAdmin });

  const form = new ActionFormData()
    .title("§l§6สมุดสถานะ RPG")
    .body(
      [
        `§fผู้เล่น: §b${player.name}`,
        `§fฉายา: ${rankOf(d.level)}`,
        `§fเลเวล: §e${d.level} §7/ ${MAX_LEVEL}`,
        xpLine,
        `§fแต้มสถานะคงเหลือ: §a${d.points}`,
        "",
      ].join("\n")
    );
  for (const b of buttons) form.button(b.text, b.icon);

  const res = await show(player, form);
  if (!res || res.canceled || res.selection === undefined) return;
  await buttons[res.selection].run(player);
}

async function backTo(player, form, back) {
  form.button("§l< กลับ");
  const res = await show(player, form);
  if (res && !res.canceled) await back(player);
}

// ---------------------------------------------------------------------------
// ข้อมูลตัวละคร
// ---------------------------------------------------------------------------

async function openProfile(player) {
  const d = getData(player);
  const s = d.stats;
  const hp = player.getComponent("minecraft:health");
  const lines = [
    `§l§eค่าสถานะ`,
    `${STATS.str.color}STR ${s.str}§7 : ดาเมจระยะประชิด +${statFx.meleeBonus(s).toFixed(1)}`,
    `${STATS.vit.color}VIT ${s.vit}§7 : เลือดสูงสุด +${statFx.maxHpBonus(s) / 2} หัวใจ, ฟื้น ${statFx.regenPerSec(s).toFixed(2)}/วิ`,
    `${STATS.def.color}DEF ${s.def}§7 : ลดดาเมจ ${pct(statFx.reduction(s))}`,
    `${STATS.agi.color}AGI ${s.agi}§7 : หลบ ${pct(statFx.dodge(s))}, ความเร็ว +${statFx.speedLevel(s)} ระดับ`,
    `${STATS.dex.color}DEX ${s.dex}§7 : คริ ${pct(statFx.critChance(s))} (x${statFx.critMult(s).toFixed(2)}), ธนู +${pct(statFx.projBonus(s))}`,
    `${STATS.luk.color}LUK ${s.luk}§7 : แร่ดรอปคู่ ${pct(statFx.doubleDrop(s))}, XP +${pct(statFx.xpBonus(s))}`,
    "",
    `§fเลือดตอนนี้: §c${hp ? Math.ceil(hp.currentValue) : "?"} / ${hp ? Math.round(hp.effectiveMax) : "?"}`,
    `§fแม่เหล็ก ${magnetRange(d.level)} บล็อก, ขุดแร่ทั้งสาย ${veinLimit(d.level)} ก้อน, ตัดไม้ ${treeLimit(d.level)} ท่อน`,
    "",
    `§l§bความชำนาญ`,
    ...PROF_IDS.map((id) => `§f${PROFS[id].name}: §bLv.${d.prof[id].level}`),
    "",
    `§l§dสกิลที่เปิดอยู่`,
    SKILLS.filter((sk) => d.skills[sk.id] && d.level >= sk.level).map((sk) => sk.name).join(", ") || "§7(ยังไม่ได้เปิด)",
  ];
  await backTo(player, new ActionFormData().title("ข้อมูลตัวละคร").body(lines.join("\n")), openMain);
}

// ---------------------------------------------------------------------------
// อัพค่าสถานะ
// ---------------------------------------------------------------------------

async function openStats(player) {
  const d = getData(player);
  const form = new ActionFormData()
    .title("อัพค่าสถานะ")
    .body(`§fแต้มคงเหลือ: §a${d.points}\n§7แตะค่าสถานะที่ต้องการอัพ (สูงสุดตัวละ ${MAX_STAT})\n`);
  for (const id of STAT_IDS) {
    const st = STATS[id];
    form.button(`${st.color}${st.name}: §0${d.stats[id]}\n§8${st.desc}`, st.icon);
  }
  form.button(`§4รีเซ็ตแต้มทั้งหมด\n§8ใช้ ${RESET_COST_LEVELS} เลเวล XP ของเกม`, "textures/items/potion_bottle_empty");
  form.button("§l< กลับ");

  const res = await show(player, form);
  if (!res || res.canceled || res.selection === undefined) return;
  const i = res.selection;
  if (i === STAT_IDS.length) return confirmReset(player);
  if (i > STAT_IDS.length) return openMain(player);

  const id = STAT_IDS[i];
  const max = Math.min(d.points, MAX_STAT - d.stats[id]);
  if (d.points <= 0) {
    player.sendMessage("§c[RPG] ไม่มีแต้มสถานะเหลือ — เลเวลอัพเพื่อรับแต้มเพิ่ม");
    return openStats(player);
  }
  if (max <= 0) {
    player.sendMessage("§c[RPG] ค่าสถานะนี้เต็มแล้ว");
    return openStats(player);
  }

  let amount = 1;
  if (max > 1) {
    const modal = new ModalFormData()
      .title(`อัพ ${STATS[id].name}`)
      .slider(`§fปัจจุบัน ${d.stats[id]} — จะเพิ่มกี่แต้ม?\n§7(แต้มคงเหลือ ${d.points})`, 1, max, {
        valueStep: 1,
        defaultValue: 1,
      })
      .submitButton("อัพเลย");
    const r = await show(player, modal);
    if (!r || r.canceled || !r.formValues) return openStats(player);
    amount = Number(r.formValues[0]);
  }
  const now = getData(player);
  amount = Math.max(0, Math.min(amount, now.points, MAX_STAT - now.stats[id]));
  now.stats[id] += amount;
  now.points -= amount;
  saveNow(player);
  player.playSound("random.orb");
  player.sendMessage(`§a[RPG] ${STATS[id].name} +${amount} §7→ ${now.stats[id]}`);
  return openStats(player);
}

async function confirmReset(player) {
  const free = isCreative(player) || isAdmin(player);
  const form = new MessageFormData()
    .title("รีเซ็ตแต้มสถานะ")
    .body(
      free
        ? "รีเซ็ตแต้มสถานะทั้งหมดเพื่อแจกใหม่?\n§7(ฟรี สำหรับผู้ดูแล/โหมดสร้างสรรค์)"
        : `รีเซ็ตแต้มสถานะทั้งหมดเพื่อแจกใหม่?\n§eต้องใช้ ${RESET_COST_LEVELS} เลเวล XP ของเกม (มีอยู่ ${player.level})`
    )
    .button1("§4ยืนยันรีเซ็ต")
    .button2("ยกเลิก");
  const res = await show(player, form);
  if (!res || res.canceled || res.selection !== 0) return openStats(player);
  if (!free) {
    if (player.level < RESET_COST_LEVELS) {
      player.sendMessage(`§c[RPG] เลเวล XP ไม่พอ (ต้องมี ${RESET_COST_LEVELS})`);
      return openStats(player);
    }
    player.addLevels(-RESET_COST_LEVELS);
  }
  const d = getData(player);
  for (const id of STAT_IDS) d.stats[id] = 0;
  d.points = totalPointsAt(d.level);
  saveNow(player);
  player.sendMessage(`§a[RPG] รีเซ็ตแล้ว ได้แต้มคืน ${d.points} แต้ม`);
  return openStats(player);
}

// ---------------------------------------------------------------------------
// ความชำนาญ
// ---------------------------------------------------------------------------

async function openProfs(player) {
  const d = getData(player);
  const form = new ActionFormData().title("ความชำนาญอาวุธ/อุปกรณ์").body("§7ใช้อุปกรณ์บ่อย ๆ เพื่ออัพเลเวล ถึงขั้นจะได้เอฟเฟกต์พิเศษ\n");
  for (const id of PROF_IDS) {
    const p = d.prof[id];
    const next = PROFS[id].perks.find((perk) => perk.level > p.level);
    form.button(
      `§l${PROFS[id].name} §r§1Lv.${p.level}/${MAX_PROF_LEVEL}\n§8${next ? `เอฟเฟกต์ถัดไป Lv.${next.level}` : "ปลดล็อกครบแล้ว"}`,
      PROFS[id].icon
    );
  }
  form.button("§l< กลับ");
  const res = await show(player, form);
  if (!res || res.canceled || res.selection === undefined) return;
  if (res.selection >= PROF_IDS.length) return openMain(player);
  return openProfDetail(player, PROF_IDS[res.selection]);
}

async function openProfDetail(player, id) {
  const p = getData(player).prof[id];
  const prof = PROFS[id];
  const need = profXpToNext(p.level);
  const lines = [
    `§fเลเวล: §b${p.level} / ${MAX_PROF_LEVEL}`,
    p.level >= MAX_PROF_LEVEL ? "§6เลเวลสูงสุดแล้ว!" : `${progressBar(p.xp, need, 30)} §f${p.xp}/${need}`,
    `§7วิธีอัพ: ${prof.how}`,
    "",
    "§l§eเอฟเฟกต์พิเศษ",
    ...prof.perks.map((perk) =>
      p.level >= perk.level ? `§a[ได้แล้ว] Lv.${perk.level}: §f${perk.text}` : `§8[ล็อก] Lv.${perk.level}: ${perk.text}`
    ),
  ];
  await backTo(player, new ActionFormData().title(prof.name).body(lines.join("\n")), openProfs);
}

// ---------------------------------------------------------------------------
// สกิล
// ---------------------------------------------------------------------------

async function openSkills(player) {
  const d = getData(player);
  const form = new ActionFormData()
    .title("สกิลพิเศษ")
    .body("§7แตะสกิลเพื่อ §aเปิด§7/§cปิด§7 — สกิลปลดล็อกเมื่อเลเวลตัวละครถึงที่กำหนด\n");
  form.button("§2เปิดทุกสกิลที่ปลดล็อก");
  form.button("§4ปิดทุกสกิล");
  for (const sk of SKILLS) {
    if (d.level >= sk.level) {
      form.button(`§l${sk.name} ${d.skills[sk.id] ? "§2[เปิด]" : "§4[ปิด]"}\n§r§8${sk.desc}`, sk.icon);
    } else {
      form.button(`§8${sk.name} [ล็อก ต้อง Lv.${sk.level}]\n${sk.desc}`, "textures/blocks/barrier");
    }
  }
  form.button("§l< กลับ");

  const res = await show(player, form);
  if (!res || res.canceled || res.selection === undefined) return;
  const i = res.selection;
  if (i === 0 || i === 1) {
    for (const sk of SKILLS) if (d.level >= sk.level) d.skills[sk.id] = i === 0;
    saveNow(player);
    player.playSound("random.click");
    return openSkills(player);
  }
  const sk = SKILLS[i - 2];
  if (!sk) return openMain(player);
  if (d.level < sk.level) {
    player.sendMessage(`§c[RPG] ${sk.name} ปลดล็อกที่เลเวล ${sk.level} (ตอนนี้ ${d.level})`);
    return openSkills(player);
  }
  d.skills[sk.id] = !d.skills[sk.id];
  saveNow(player);
  player.playSound(d.skills[sk.id] ? "random.orb" : "random.click");
  player.onScreenDisplay.setActionBar(`${sk.name}: ${d.skills[sk.id] ? "§aเปิด" : "§cปิด"}`);
  return openSkills(player);
}

// ---------------------------------------------------------------------------
// ตั้งค่า
// ---------------------------------------------------------------------------

async function openSettings(player) {
  const d = getData(player);
  const st = d.settings;
  const maxMagnet = magnetRange(d.level);
  const form = new ModalFormData()
    .title("ตั้งค่า")
    .toggle("แสดงแถบ XP เมื่อได้รับ XP", { defaultValue: st.hud })
    .toggle("ขุดแร่ทั้งสาย: ต้องย่อตัวถึงจะทำงาน", { defaultValue: st.veinSneak })
    .toggle("ตัดต้นไม้ทั้งต้น: ต้องย่อตัวถึงจะทำงาน", { defaultValue: st.treeSneak })
    .toggle("ตัดต้นไม้ทั้งต้น: ทำลายใบไม้ด้วย", { defaultValue: st.treeLeaves })
    .slider(`ระยะแม่เหล็ก (0 = สูงสุด ${maxMagnet} บล็อก)`, 0, maxMagnet, {
      valueStep: 1,
      defaultValue: Math.min(st.magnetRange, maxMagnet),
    })
    .submitButton("บันทึก");
  const res = await show(player, form);
  if (!res || res.canceled || !res.formValues) return openMain(player);
  const v = res.formValues;
  st.hud = v[0] === true;
  st.veinSneak = v[1] === true;
  st.treeSneak = v[2] === true;
  st.treeLeaves = v[3] === true;
  st.magnetRange = Number(v[4]) || 0;
  saveNow(player);
  player.sendMessage("§a[RPG] บันทึกการตั้งค่าแล้ว");
  return openMain(player);
}

// ---------------------------------------------------------------------------
// วิธีเล่น
// ---------------------------------------------------------------------------

async function openHelp(player) {
  const lines = [
    "§l§eรับ XP ตัวละคร",
    "§f- ฆ่ามอนสเตอร์ (บอสได้เยอะมาก)",
    "§f- ขุดแร่ (เพชร/มรกต/เศษโบราณได้เยอะ), ตัดไม้, เก็บพืชที่โตแล้ว",
    "§f- ขุดบล็อกทั่วไปได้นิดหน่อย",
    "",
    "§l§eเลเวลอัพ",
    "§f- ได้ 3 แต้มสถานะ (ทุก 10 เลเวลได้เพิ่ม 5) นำไปอัพในเมนู",
    "§f- ถึงเลเวลที่กำหนดจะปลดล็อกสกิลใหม่ เปิด/ปิดได้ในเมนูสกิล",
    "",
    "§l§eความชำนาญ",
    "§f- ใช้ดาบ/ขวาน/อีเตอร์/พลั่ว/จอบ/ธนู/ตรีศูล/เกราะ จะอัพเลเวลของสิ่งนั้น",
    "§f- ทุก 10 เลเวลได้เอฟเฟกต์พิเศษของอุปกรณ์นั้น (สูงสุด Lv.50)",
    "",
    "§l§eวิธีบิน (สกิล Lv.30)",
    "§f- ถ้าเปิด §bEducation Edition§f ในตั้งค่าโลก: แตะกระโดด 2 ครั้ง บินเหมือนโหมดสร้างสรรค์",
    "§f- ถ้าไม่ได้เปิด: กดกระโดดค้าง = ขึ้น, ย่อ = ลง, ไม่กด = ลอยนิ่ง, จอย = บินไปทางที่มอง, วิ่ง = เร็วขึ้น",
    "",
    "§l§eเคล็ดลับ",
    "§f- แม่เหล็ก: ย่อตัวเพื่อหยุดดูดชั่วคราว (เวลาจะทิ้งของ)",
    "§f- ขุดแร่ทั้งสาย/ตัดต้นไม้ จะหยุดเองก่อนเครื่องมือพัง",
    "§f- ตัดต้นไม้ทั้งต้นทำงานเฉพาะต้นไม้ธรรมชาติ (มีใบไม้) ไม่พังบ้านไม้",
    "§f- สมุดหาย? คราฟใหม่: หนังสือ + ลาพิส ลาซูลี",
    "§f- ตาย ไม่เสียเลเวล",
  ];
  await backTo(player, new ActionFormData().title("วิธีเล่น").body(lines.join("\n")), openMain);
}

// ---------------------------------------------------------------------------
// ผู้ดูแล
// ---------------------------------------------------------------------------

const MULTS = [0.5, 1, 2, 3, 5, 10];

async function openAdmin(player) {
  const w = getWorld();
  const players = world.getAllPlayers();
  const form = new ModalFormData()
    .title("ผู้ดูแลโลก")
    .dropdown(
      "ตัวคูณ XP ของทั้งโลก",
      MULTS.map((m) => `x${m}`),
      { defaultValueIndex: Math.max(0, MULTS.indexOf(w.xpMult)) }
    )
    .toggle("แสดงเลเวลเหนือชื่อผู้เล่น", { defaultValue: w.nameTag })
    .dropdown(
      "ผู้เล่นเป้าหมาย (สำหรับ 2 ช่องล่าง)",
      players.map((p) => p.name),
      { defaultValueIndex: Math.max(0, players.findIndex((p) => p.id === player.id)) }
    )
    .textField("ตั้งเลเวลผู้เล่นเป้าหมาย (เว้นว่าง = ไม่เปลี่ยน)", `1 - ${MAX_LEVEL}`)
    .toggle("§cล้างข้อมูล RPG ทั้งหมดของผู้เล่นเป้าหมาย", { defaultValue: false })
    .submitButton("ตกลง");
  const res = await show(player, form);
  if (!res || res.canceled || !res.formValues) return openMain(player);
  const v = res.formValues;

  w.xpMult = MULTS[Number(v[0])] ?? 1;
  w.nameTag = v[1] === true;
  saveWorld();
  for (const p of world.getAllPlayers()) updateNameTag(p);

  const target = players[Number(v[2])];
  if (target?.isValid) {
    if (v[4] === true) {
      resetData(target);
      updateNameTag(target);
      player.sendMessage(`§e[RPG] ล้างข้อมูลของ ${target.name} แล้ว`);
    } else {
      const lv = parseInt(String(v[3] ?? ""), 10);
      if (!Number.isNaN(lv)) {
        setLevel(target, lv);
        player.sendMessage(`§e[RPG] ตั้งเลเวล ${target.name} เป็น ${getData(target).level}`);
      }
    }
  }
  player.sendMessage(`§a[RPG] บันทึกแล้ว (ตัวคูณ XP x${w.xpMult})`);
}

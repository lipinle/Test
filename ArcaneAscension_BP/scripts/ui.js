import { system } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData, CustomForm, ObservableBoolean } from "@minecraft/server-ui";
import {
  SPELLS, SPELL_ORDER, ATTRS, ELEMENTS, QUESTS, BESTIARY, RIFT_TIERS, ARMOR_SETS, xpToNext, MAX_LEVEL,
} from "./config.js";
import { getData, saveData, markDirty, worldSettings, saveWorldSettings, resetData } from "./data.js";
import { maxMana, manaRegen, questState, claimQuest, claimableCount, questProgress, setLevel } from "./progression.js";
import { cdLeft, manaCost, cooldownTicks, spellPower, resetCooldowns } from "./spells.js";
import { armorOf } from "./combat.js";
import { openWaystoneMenu } from "./waystones.js";
import { activeRiftOf, isInsideRift, enterRift, leaveRift, openRift, riftList, forceCollapseAll, riftDimension } from "./rifts.js";
import { startBloodMoon, stopBloodMoon, bloodMoonActive } from "./events.js";
import { fx, psound } from "./fx.js";
import { countItem, consumeItem, giveItem, itemName, tell, isOp, isCreative, roman, fmt, fmt1, bar, getMainhand, actionbar, safe } from "./util.js";

const ICON = (k) => `textures/arc_ui/${k}`;
const SPELL_ICON = (id) => `textures/arc_ui/spell_${id}`;

export function show(form, player, actions, attempt = 0) {
  form.show(player).then((res) => {
    if (res.canceled && res.cancelationReason === "UserBusy" && attempt < 20) {
      system.runTimeout(() => show(form, player, actions, attempt + 1), 5);
      return;
    }
    if (res.canceled || res.selection === undefined) return;
    try {
      actions[res.selection]?.();
    } catch (err) {
      console.warn(`[Arcane] ui: ${err}`);
    }
  });
}

// ============================================================ เมนูหลัก
export function openGrimoire(player) {
  const d = getData(player);
  const max = maxMana(player, d);
  const claim = claimableCount(d);
  const f = new ActionFormData().title("§d§lคัมภีร์เวทอาร์เคน");
  const xpLine = d.lvl >= MAX_LEVEL ? "§6(เลเวลสูงสุด)" : `§7${fmt(d.xp)}/${fmt(xpToNext(d.lvl))} XP`;
  f.body(
    `§e★ เลเวล ${d.lvl} ${xpLine}\n` +
      `§b◆ มานา ${Math.floor(d.mana)}/${max} §8(+${fmt1(manaRegen(player, d))}/วิ)\n` +
      (d.pts ? `§a✦ มีแต้มค่าสถานะ ${d.pts} แต้มรอใช้!\n` : "") +
      (claim ? `§a✔ ภารกิจรอรับรางวัล ${claim} อย่าง\n` : "") +
      (bloodMoonActive() ? "§4☾ คืนนี้จันทร์สีเลือด! XP x2\n" : ""),
  );
  /** @type {[string, string, () => void][]} */
  const menu = [
    [`§lสถานะ & ค่าสถานะ${d.pts ? ` §a(+${d.pts})` : ""}`, "menu_character", () => characterMenu(player)],
    ["§lคาถาทั้งหมด", "menu_spells", () => spellsMenu(player)],
    ["§lช่องคาถาที่พกไว้", "menu_mana", () => loadoutMenu(player)],
    [`§lภารกิจ${claim ? ` §a(${claim})` : ""}`, "menu_quests", () => questsMenu(player)],
    ["§lเครือข่ายหินวาร์ป", "menu_waystones", () => openWaystoneMenu(player)],
    ["§lรอยแยกมิติ", "menu_rift", () => riftMenu(player)],
    ["§lบันทึกสัตว์ประหลาด", "menu_bestiary", () => bestiaryMenu(player)],
    ["§lคู่มือ", "menu_back", () => guideMenu(player)],
    ["§lตั้งค่า", "menu_settings", () => settingsMenu(player)],
  ];
  if (isOp(player)) menu.push(["§c§lผู้ดูแล (OP)", "menu_admin", () => adminMenu(player)]);
  for (const [t, icon] of menu) f.button(t, ICON(icon));
  show(f, player, menu.map((m) => m[2]));
}

// ============================================================ สถานะ
function characterMenu(player) {
  const d = getData(player);
  const sets = armorOf(player);
  const staff = getMainhand(player);
  const staffId = staff && staff.typeId.endsWith("_staff") ? staff.typeId : "arc:apprentice_staff";
  const power = spellPower(player, d, SPELLS.arcane_bolt, staffId);
  const need = xpToNext(d.lvl);
  let body = `§e★ เลเวล ${d.lvl}/${MAX_LEVEL}\n${bar(d.lvl >= MAX_LEVEL ? 1 : d.xp / need, 30, "§a", "§8")} §7${d.lvl >= MAX_LEVEL ? "MAX" : `${fmt(d.xp)}/${fmt(need)}`}\n\n`;
  body += `§b◆ มานาสูงสุด ${maxMana(player, d)}  §7ฟื้น ${fmt1(manaRegen(player, d))}/วินาที\n`;
  body += `§d✦ พลังเวท x${fmt1(power)} §8(คำนวณจากคทาที่ถือ)\n`;
  body += `§e⌛ ลดคูลดาวน์ ${Math.min(40, d.attr.cel)}%\n\n`;
  for (const [k, a] of Object.entries(ATTRS)) body += `${a.color}${a.name} (${a.short}): §f${d.attr[k]}\n§8  ${a.desc}\n`;
  if (sets.archmage || sets.voidplate) {
    body += "\n§7ชุดเกราะ:\n";
    if (sets.archmage) body += `§d${ARMOR_SETS.archmage.name} ${sets.archmage}/4 ${sets.archmage >= 4 ? `§a(${ARMOR_SETS.archmage.full})` : ""}\n`;
    if (sets.voidplate) body += `§5${ARMOR_SETS.voidplate.name} ${sets.voidplate}/4 ${sets.voidplate >= 4 ? `§a(${ARMOR_SETS.voidplate.full})` : ""}\n`;
  }
  body += `\n§7สถิติ: ร่ายเวท ${fmt(d.st.casts)} ครั้ง • ใช้มานา ${fmt(d.st.mana)} • ขุดแร่อาร์เคน ${fmt(d.st.ore)}`;
  body += `\n\n${d.pts ? `§a✦ แต้มที่ใช้ได้: ${d.pts}` : "§8ไม่มีแต้มเหลือ (ได้ 3 แต้มทุกเลเวล)"}`;
  const f = new ActionFormData().title("§d§lสถานะตัวละคร").body(body);
  const actions = [];
  for (const [k, a] of Object.entries(ATTRS)) {
    f.button(`${a.color}§l+1 ${a.name}§r\n§8ตอนนี้ ${d.attr[k]}`, ICON("menu_character"));
    actions.push(() => {
      if (d.pts <= 0) return tell(player, "§cไม่มีแต้มค่าสถานะเหลือ");
      if (k === "cel" && d.attr.cel >= 40) return tell(player, "§cความเร็วร่ายเวทสูงสุดแล้ว (40)");
      d.pts--;
      d.attr[k]++;
      saveData(player);
      psound(player, "random.orb", 0.6, 1.6);
      characterMenu(player);
    });
  }
  f.button("§cรีเซ็ตแต้มทั้งหมด\n§8ใช้หัวใจผลึก 1 ชิ้น", ICON("menu_locked"));
  actions.push(() => {
    if (!isCreative(player) && !consumeItem(player, "arc:crystal_heart", 1)) return tell(player, "§cต้องมีหัวใจผลึก 1 ชิ้น");
    const total = d.attr.int + d.attr.wis + d.attr.vit + d.attr.cel;
    d.attr = { int: 0, wis: 0, vit: 0, cel: 0 };
    d.pts += total;
    safe(() => player.removeEffect("health_boost"));
    saveData(player);
    tell(player, `§a✦ รีเซ็ตแล้ว ได้คืน ${total} แต้ม`);
    characterMenu(player);
  });
  f.button("« กลับ", ICON("menu_back"));
  actions.push(() => openGrimoire(player));
  show(f, player, actions);
}

// ============================================================ คาถา
function spellStatus(d, id) {
  const s = SPELLS[id];
  if (d.known.includes(id)) return "§a✔ เรียนแล้ว";
  if (d.lvl >= s.level) return `§eเรียนได้ • ใช้เศษผลึก ${s.cost}`;
  return `§8🔒 ต้องเลเวล ${s.level}`;
}

function spellsMenu(player) {
  const d = getData(player);
  const f = new ActionFormData().title("§d§lคาถา").body(`§7เรียนแล้ว ${d.known.length}/${SPELL_ORDER.length} • เศษผลึกอาร์เคนในกระเป๋า: §d${countItem(player, "arc:arcane_shard")}`);
  const actions = [];
  for (const id of SPELL_ORDER) {
    const s = SPELLS[id];
    f.button(`${ELEMENTS[s.element].c}§l${s.name}§r\n${spellStatus(d, id)}`, SPELL_ICON(id));
    actions.push(() => spellDetail(player, id));
  }
  f.button("« กลับ", ICON("menu_back"));
  actions.push(() => openGrimoire(player));
  show(f, player, actions);
}

function spellDetail(player, id) {
  const d = getData(player);
  const s = SPELLS[id];
  const el = ELEMENTS[s.element];
  const staff = getMainhand(player);
  const staffId = staff && staff.typeId.endsWith("_staff") ? staff.typeId : "arc:apprentice_staff";
  const body =
    `${el.c}ธาตุ${el.name}\n\n§f${s.desc}\n\n` +
    `§9มานา: ${manaCost(player, id, staffId)}\n§eคูลดาวน์: ${fmt1(cooldownTicks(d, id) / 20)} วินาที\n` +
    `§dพลังเวทตอนนี้: x${fmt1(spellPower(player, d, s, staffId))}\n§7เลเวลที่ต้องการ: ${s.level}\n` +
    (d.known.includes(id) ? "§a✔ เรียนแล้ว" : `§7ค่าเรียน: §d${s.cost} เศษผลึกอาร์เคน`);
  const f = new ActionFormData().title(`${el.c}§l${s.name}`).body(body);
  const actions = [];
  if (!d.known.includes(id)) {
    f.button(`§lเรียนคาถานี้\n§8ใช้เศษผลึก ${s.cost}`, SPELL_ICON(id));
    actions.push(() => learnSpell(player, id));
  } else {
    for (let i = 0; i < 4; i++) {
      const cur = d.loadout[i];
      f.button(`ใส่ช่อง ${i + 1}\n§8ตอนนี้: ${cur ? SPELLS[cur].name : "ว่าง"}`, cur ? SPELL_ICON(cur) : ICON("menu_mana"));
      actions.push(() => {
        const prev = d.loadout.indexOf(id);
        if (prev >= 0) d.loadout[prev] = null;
        d.loadout[i] = id;
        d.sel = i;
        saveData(player);
        tell(player, `§d✦ ใส่ ${s.name} ไว้ช่อง ${i + 1}`);
      });
    }
  }
  f.button("« กลับ", ICON("menu_back"));
  actions.push(() => spellsMenu(player));
  show(f, player, actions);
}

function learnSpell(player, id) {
  const d = getData(player);
  const s = SPELLS[id];
  if (d.known.includes(id)) return;
  if (d.lvl < s.level && !isCreative(player)) return tell(player, `§cต้องเลเวล ${s.level}`);
  if (!isCreative(player) && !consumeItem(player, "arc:arcane_shard", s.cost)) return tell(player, `§cเศษผลึกอาร์เคนไม่พอ (ต้องการ ${s.cost})`);
  d.known.push(id);
  const empty = d.loadout.indexOf(null);
  if (empty >= 0) d.loadout[empty] = id;
  saveData(player);
  questProgress(player, "learn");
  questProgress(player, "spell", id);
  fx.rise(player.dimension, player.location, ELEMENTS[s.element].rgb, 1, 30, 3);
  fx.rune(player.dimension, player.location, 2, ELEMENTS[s.element].rgb, 1.5, 120);
  psound(player, "block.enchanting_table.use", 1, 1);
  psound(player, "random.levelup", 0.6, 1.5);
  tell(player, `§d✦ เรียนคาถา ${s.name} สำเร็จ!${empty >= 0 ? ` §7(ใส่ไว้ช่อง ${empty + 1})` : " §7(เลือกช่องได้ในเมนูคาถา)"}`);
}

function loadoutMenu(player) {
  const d = getData(player);
  const f = new ActionFormData().title("§d§lช่องคาถาที่พกไว้").body("§7คาถาใน 4 ช่องนี้คือที่ร่ายได้ด้วยคทา\n§8ย่อตัว+แตะโจมตี (ถือคทา) = สลับคาถาถัดไป\n§8ย่อตัว+ใช้คทา = วงล้อเลือกคาถา");
  const actions = [];
  for (let i = 0; i < 4; i++) {
    const cur = d.loadout[i];
    f.button(`${i === d.sel ? "§a► " : ""}ช่อง ${i + 1}: §l${cur ? SPELLS[cur].name : "ว่าง"}`, cur ? SPELL_ICON(cur) : ICON("menu_mana"));
    actions.push(() => pickForSlot(player, i));
  }
  f.button("« กลับ", ICON("menu_back"));
  actions.push(() => openGrimoire(player));
  show(f, player, actions);
}

function pickForSlot(player, slot) {
  const d = getData(player);
  const f = new ActionFormData().title(`§dเลือกคาถาสำหรับช่อง ${slot + 1}`);
  const actions = [];
  f.button("§8(ว่าง)", ICON("menu_locked"));
  actions.push(() => {
    d.loadout[slot] = null;
    saveData(player);
    loadoutMenu(player);
  });
  for (const id of SPELL_ORDER.filter((x) => d.known.includes(x))) {
    f.button(`${ELEMENTS[SPELLS[id].element].c}${SPELLS[id].name}`, SPELL_ICON(id));
    actions.push(() => {
      const prev = d.loadout.indexOf(id);
      if (prev >= 0) d.loadout[prev] = null;
      d.loadout[slot] = id;
      saveData(player);
      loadoutMenu(player);
    });
  }
  show(f, player, actions);
}

/** ย่อตัว + ใช้คทา */
export function openSpellWheel(player) {
  const d = getData(player);
  const f = new ActionFormData().title("§d§lวงล้อคาถา");
  const actions = [];
  for (let i = 0; i < 4; i++) {
    const id = d.loadout[i];
    if (!id) continue;
    const cd = cdLeft(player, id);
    f.button(`${i === d.sel ? "§a► " : ""}§l${SPELLS[id].name}§r\n${cd > 0 ? `§cคูลดาวน์ ${fmt1(cd / 20)} วิ` : "§aพร้อม"}`, SPELL_ICON(id));
    actions.push(() => {
      d.sel = i;
      markDirty(player);
      actionbar(player, `§dเลือก: §f${SPELLS[id].name}`);
      psound(player, "random.click", 0.6, 1.4);
    });
  }
  f.button("§7เปิดคัมภีร์", ICON("menu_spells"));
  actions.push(() => openGrimoire(player));
  show(f, player, actions);
}

/** ย่อตัว + แตะโจมตี: สลับไปคาถาถัดไปเร็ว ๆ */
export function cycleSpell(player) {
  const d = getData(player);
  for (let k = 1; k <= 4; k++) {
    const i = (d.sel + k) % 4;
    if (d.loadout[i]) {
      d.sel = i;
      markDirty(player);
      const s = SPELLS[d.loadout[i]];
      actionbar(player, `${d.set.glyph ? s.glyph + " " : ""}§dเลือก: §f${s.name} §8[${i + 1}]`);
      psound(player, "random.click", 0.5, 1.6);
      return;
    }
  }
}

// ============================================================ ภารกิจ
function questsMenu(player) {
  const d = getData(player);
  const list = [...QUESTS].sort((a, b) => {
    const sa = questState(d, a);
    const sb = questState(d, b);
    const ra = sa.done && !sa.c ? 0 : sa.c ? 2 : 1;
    const rb = sb.done && !sb.c ? 0 : sb.c ? 2 : 1;
    return ra - rb;
  });
  const done = QUESTS.filter((q) => questState(d, q).c).length;
  const f = new ActionFormData().title("§a§lภารกิจ").body(`§7สำเร็จแล้ว ${done}/${QUESTS.length}`);
  const actions = [];
  for (const q of list) {
    const s = questState(d, q);
    const status = s.c ? "§8✔ รับรางวัลแล้ว" : s.done ? "§a§l★ แตะเพื่อรับรางวัล!" : `§7${Math.min(s.p, q.count)}/${q.count}`;
    f.button(`${s.c ? "§8" : "§l"}${q.name}§r\n${status}`, ICON(s.c || s.done ? "menu_quests" : "menu_locked"));
    actions.push(() => {
      if (s.done && !s.c) {
        claimQuest(player, q);
        questsMenu(player);
        return;
      }
      new MessageFormData()
        .title(`§a${q.name}`)
        .body({
          rawtext: [
            { text: `§f${q.desc}\n\n§7ความคืบหน้า: ${Math.min(s.p, q.count)}/${q.count}\n§eรางวัล: ${q.xp} XP` },
            ...(q.items ?? []).flatMap(([id, n]) => [{ text: `\n§f• ${n}x ` }, itemName(String(id))]),
          ],
        })
        .button1("« กลับ")
        .button2("ปิด")
        .show(player)
        .then((r) => !r.canceled && r.selection === 0 && questsMenu(player));
    });
  }
  f.button("« กลับ", ICON("menu_back"));
  actions.push(() => openGrimoire(player));
  show(f, player, actions);
}

// ============================================================ รอยแยก
function riftMenu(player) {
  const d = getData(player);
  const rt = activeRiftOf(player);
  let body = "§7ใช้ §dกุญแจรอยแยกมิติ§7 เพื่อเปิดประตูสู่ดันเจี้ยนที่สุ่มสร้างใหม่ทุกครั้ง\n";
  body += riftDimension() ? "§8(สร้างในมิติใหม่ The Rift)\n\n" : "§8(สร้างบนท้องฟ้าเหนือจุดที่เปิด)\n\n";
  for (const t of [1, 2, 3]) {
    const info = RIFT_TIERS[t];
    const best = d.rift.best[t];
    body += `${info.color}ระดับ ${info.name}§7: ผ่าน ${d.rift.clears[t] ?? 0} ครั้ง${best ? ` • เร็วสุด ${Math.floor(best / 60)}:${String(best % 60).padStart(2, "0")}` : ""} §8(Lv ${info.level}+)\n`;
  }
  if (rt) body += `\n§dรอยแยกของคุณ: ระดับ ${roman(rt.rec.tier)} • สถานะ ${rt.rec.state}`;
  const f = new ActionFormData().title("§5§lรอยแยกมิติ").body(body);
  const actions = [];
  if (rt && !rt.collapsing) {
    if (isInsideRift(player, rt)) {
      f.button("§cออกจากรอยแยก\n§8กลับไปจุดที่เข้ามา", ICON("menu_rift"));
      actions.push(() => leaveRift(player));
    } else {
      f.button("§aกลับเข้ารอยแยก", ICON("menu_rift"));
      actions.push(() => enterRift(player, rt));
    }
  }
  f.button("« กลับ", ICON("menu_back"));
  actions.push(() => openGrimoire(player));
  show(f, player, actions);
}

// ============================================================ สัตว์ประหลาด
function bestiaryMenu(player) {
  const d = getData(player);
  const f = new ActionFormData().title("§c§lบันทึกสัตว์ประหลาด");
  const actions = [];
  for (const b of BESTIARY) {
    const n = d.kills[b.id] ?? 0;
    f.button(n ? `§l${b.name}§r\n§7กำจัดแล้ว ${fmt(n)} ตัว` : "§8§l???\n§8ยังไม่เคยพบ", ICON(n ? "menu_bestiary" : "menu_locked"));
    actions.push(() => {
      new MessageFormData()
        .title(n ? b.name : "???")
        .body(n ? `§f${b.lore}\n\n§7กำจัดแล้ว: ${fmt(n)}` : "§7กำจัดสักตัวเพื่อปลดล็อกข้อมูล")
        .button1("« กลับ")
        .button2("ปิด")
        .show(player)
        .then((r) => !r.canceled && r.selection === 0 && bestiaryMenu(player));
    });
  }
  f.button("« กลับ", ICON("menu_back"));
  actions.push(() => openGrimoire(player));
  show(f, player, actions);
}

// ============================================================ คู่มือ
const GUIDE = [
  ["เริ่มต้น", "§f1. ขุด §dแร่อาร์เคน§f (ใต้ดิน Y -54 ถึง 48) ด้วยอีเต้อ ได้เศษผลึก\n2. คราฟ §dคทาเด็กฝึกเวท§f: เศษผลึก 1 + ไม้ 2 (แนวทแยง)\n3. ถือคทาแล้วกดใช้ = ร่ายเวท\n4. คัมภีร์นี้คราฟได้จากหนังสือ + เศษผลึก\n5. เรียนคาถาใหม่ในเมนู คาถา (ใช้เศษผลึก)\n\n§7เศษผลึกยังได้จาก: โกเลมผลึก, ทุบกระจุกอเมทิสต์ (20%), หีบในรอยแยก"],
  ["การร่ายเวท", "§fถือคทา:\n§e• กดใช้§f = ร่ายคาถาที่เลือก\n§e• ย่อตัว + กดใช้§f = วงล้อเลือกคาถา\n§e• ย่อตัว + แตะโจมตี§f = สลับไปคาถาถัดไป\n\nคาถาใช้มานา (แถบสีฟ้าด้านล่างจอ) มานาฟื้นเองตลอดเวลา\nคทาแต่ละธาตุทำให้คาถาธาตุเดียวกันแรงขึ้น 40%\nคทาอาร์คเมจเพิ่มพลังทุกธาตุและลดมานา 20%"],
  ["ค่าสถานะ", "§fได้ 3 แต้มทุกเลเวล ใช้ในเมนู สถานะ\n§dINT§f พลังเวท • §bWIS§f มานา • §cVIT§f หัวใจ • §eCEL§f ลดคูลดาวน์\n\nXP ได้จาก: ฆ่ามอนสเตอร์, ร่ายเวท, ขุดแร่อาร์เคน, ภารกิจ, รอยแยก, บอส"],
  ["แท่นบูชา & รูน", "§fคราฟ §5แท่นบูชาอาร์เคน§f แล้วแตะเพื่อหลอมรวม: คทาธาตุ, ชุดเกราะ, รูน, ตราอัญเชิญบอส\n\n§fถือดาบ/ขวาน/หอก/ตรีศูล แล้วแตะแท่นบูชา = §dโรงตีรูน§f ใส่รูนลงอาวุธ\n§8ดาบรูนใส่ได้ 3 ช่อง, ดาบพิฆาตมิติ 2 ช่อง, อาวุธอื่น 1 ช่อง"],
  ["หินวาร์ป", "§fวางหินวาร์ปแล้วตั้งชื่อ แตะหินวาร์ปเพื่อค้นพบ แตะอีกครั้งเพื่อเลือกที่วาร์ป (ข้ามมิติได้)\nใช้มานา 20 ต่อครั้ง\nหินวาร์ปที่รู้จักจะขึ้นบนแถบตำแหน่ง (Locator Bar) ด้วย"],
  ["รอยแยกมิติ", "§fใช้กุญแจรอยแยก → เลือกระดับ → ประตูมิติจะเปิดตรงหน้า เพื่อนเดินเข้าประตูเดียวกันได้\nข้างในคือดันเจี้ยน 16 ห้องที่สุ่มใหม่ทุกครั้ง: ห้องต่อสู้ (ประตูจะผนึก), ห้องสมบัติ, แท่นฟื้นพลัง\nเคลียร์ห้องต่อสู้ทั้งหมด → ทางสู่ลานบอสเปิด → ชนะบอส → หีบรางวัล + ประตูทางออก\n§8ตายในรอยแยก? กลับเข้าไปได้จากเมนู รอยแยกมิติ"],
  ["บอส", "§6ยักษ์เพลิงโคลอสซัส§f: ทุบพื้น, ฝนลูกไฟ, ลาวาปะทุใต้เท้า, คลั่งเมื่อเลือดครึ่ง\n§5ไททันแห่งความว่างเปล่า§f: 3 ระยะ — ลูกเวทติดตาม → โล่ผลึก 4 ก้อน (ทำลายให้หมด!) → ลำแสงความว่างเปล่าและฝนอุกกาบาต\nอัญเชิญได้ด้วยตรา หรือเจอเป็นบอสรอยแยกระดับ II/III"],
  ["จันทร์สีเลือด", "§fทุก 7 คืน (หรือสุ่ม) ท้องฟ้าจะแดงฉาน มอนสเตอร์เกิดเป็นฝูงรอบตัวและแข็งแกร่งขึ้น\nแต่ XP จากมอนสเตอร์ได้ 2 เท่า!\n§8ผู้ดูแลปิดได้ในเมนู ผู้ดูแล → ตั้งค่าโลก"],
];

function guideMenu(player) {
  const f = new ActionFormData().title("§d§lคู่มือ Arcane Ascension").body("§7เลือกหัวข้อ");
  /** @type {(() => void)[]} */
  const actions = GUIDE.map(([t, text]) => {
    f.button(`§l${t}`, ICON("menu_back"));
    return () => {
      new MessageFormData().title(`§d${t}`).body(text).button1("« กลับ").button2("ปิด").show(player).then((r) => {
        if (!r.canceled && r.selection === 0) guideMenu(player);
      });
    };
  });
  f.button("« กลับ", ICON("menu_back"));
  actions.push(() => openGrimoire(player));
  show(f, player, actions);
}

// ============================================================ ตั้งค่า (DDUI แบบอัปเดตสด + สำรองแบบเก่า)
const SETTINGS = [
  ["hud", "แสดง HUD มานา/คาถา", "แถบมานาและคาถาที่เลือกเหนือแถบไอเท็ม"],
  ["glyph", "ใช้ไอคอนกราฟิกใน HUD", "ปิดถ้าเห็นเป็นกล่องสี่เหลี่ยม (ใช้ตัวอักษรแทน)"],
  ["dmg", "ตัวเลขดาเมจลอย", "แสดงดาเมจที่ทำได้เหนือศัตรู"],
  ["cine", "คัตซีนเปิดตัวบอส", "กล้องหมุนรอบบอสตอนปรากฏตัว"],
  ["shake", "จอสั่น", "สั่นตอนระเบิด/บอสทุบพื้น"],
];

function settingsMenu(player) {
  const d = getData(player);
  try {
    const obs = {};
    const form = new CustomForm(player, "§d§lตั้งค่าส่วนตัว");
    form.label("§7เปลี่ยนแล้วมีผลทันที");
    for (const [k, label, desc] of SETTINGS) {
      obs[k] = new ObservableBoolean(!!d.set[k], { clientWritable: true });
      obs[k].subscribe((v) => {
        d.set[k] = v;
        markDirty(player);
      });
      form.toggle(label, obs[k], { description: desc });
    }
    form.closeButton();
    form.show().then(() => saveData(player)).catch(() => saveData(player));
    return;
  } catch (err) {
    console.warn(`[Arcane] DDUI unavailable, using ModalForm: ${err}`);
  }
  const f = new ModalFormData().title("§d§lตั้งค่าส่วนตัว");
  for (const [k, label] of SETTINGS) f.toggle(label, { defaultValue: !!d.set[k] });
  f.submitButton("บันทึก");
  f.show(player).then((res) => {
    if (res.canceled || !res.formValues) return;
    SETTINGS.forEach(([k], i) => (d.set[k] = !!res.formValues[i]));
    saveData(player);
    tell(player, "§a✔ บันทึกการตั้งค่าแล้ว");
  });
}

// ============================================================ ผู้ดูแล
/** @type {[string, number][]} */
export const TEST_KIT = [
  ["arc:grimoire", 1], ["arc:apprentice_staff", 1], ["arc:ember_staff", 1], ["arc:frost_staff", 1], ["arc:storm_staff", 1],
  ["arc:void_staff", 1], ["arc:archmage_staff", 1], ["arc:runeblade", 1], ["arc:void_reaver", 1],
  ["arc:archmage_hood", 1], ["arc:archmage_robe", 1], ["arc:archmage_leggings", 1], ["arc:archmage_boots", 1],
  ["arc:voidplate_helmet", 1], ["arc:voidplate_chestplate", 1], ["arc:voidplate_leggings", 1], ["arc:voidplate_boots", 1],
  ["arc:arcane_shard", 64], ["arc:arcane_ingot", 32], ["arc:void_essence", 32], ["arc:ember_core", 32], ["arc:crystal_heart", 8],
  ["arc:titan_heart", 2], ["arc:mana_potion", 8], ["arc:greater_mana_potion", 8], ["arc:rift_key", 8], ["arc:ember_sigil", 2],
  ["arc:void_sigil", 2], ["arc:rune_fire", 2], ["arc:rune_frost", 2], ["arc:rune_storm", 2], ["arc:rune_leech", 2],
  ["arc:waystone", 4], ["arc:arcane_altar", 1],
];

function spawnAhead(player, type) {
  const dir = player.getViewDirection();
  const loc = { x: player.location.x + dir.x * 8, y: player.location.y, z: player.location.z + dir.z * 8 };
  try {
    player.dimension.spawnEntity(type, loc);
  } catch (err) {
    tell(player, `§c${err}`);
  }
}

export function giveKit(player) {
  for (const [id, n] of TEST_KIT) giveItem(player, id, n);
}

export function maxOut(player) {
  const d = getData(player);
  setLevel(player, MAX_LEVEL);
  d.known = [...SPELL_ORDER];
  d.loadout = ["fireball", "chain_lightning", "black_hole", "cataclysm"];
  d.mana = maxMana(player, d);
  resetCooldowns(player);
  saveData(player);
}

function adminMenu(player) {
  const ws = worldSettings();
  const f = new ActionFormData().title("§c§lผู้ดูแล").body(`§7ตั้งค่าโลก: จันทร์สีเลือด ${ws.bloodMoon ? "§aเปิด" : "§cปิด"}§7 • PvP ${ws.pvp ? "§aเปิด" : "§cปิด"}§7 • สายฟ้าจริง ${ws.realLightning ? "§aเปิด" : "§cปิด"}\n§7รอยแยกที่เปิดอยู่: ${riftList().length}`);
  /** @type {[string, () => void][]} */
  const actions = [
    ["รับชุดทดสอบ (ไอเท็มครบทุกชิ้น)", () => giveKit(player)],
    ["เลเวลสูงสุด + เรียนทุกคาถา", () => maxOut(player)],
    [bloodMoonActive() ? "หยุดจันทร์สีเลือด" : "เริ่มจันทร์สีเลือดทันที", () => (bloodMoonActive() ? stopBloodMoon() : startBloodMoon())],
    ["อัญเชิญยักษ์เพลิงตรงหน้า", () => spawnAhead(player, "arc:ember_colossus")],
    ["อัญเชิญไททันตรงหน้า", () => spawnAhead(player, "arc:void_titan")],
    ["เปิดรอยแยกระดับ I", () => openRift(player, 1)],
    ["เปิดรอยแยกระดับ II", () => openRift(player, 2)],
    ["เปิดรอยแยกระดับ III", () => openRift(player, 3)],
    ["ปิดรอยแยกทั้งหมด", () => forceCollapseAll()],
    ["ตั้งค่าโลก", () => worldSettingsMenu(player)],
    ["§cรีเซ็ตข้อมูลตัวเอง", () => resetData(player)],
    ["« กลับ", () => openGrimoire(player)],
  ];
  for (const [t] of actions) f.button(t, ICON("menu_admin"));
  show(f, player, actions.map((a) => a[1]));
}

function worldSettingsMenu(player) {
  const ws = worldSettings();
  new ModalFormData()
    .title("§cตั้งค่าโลก")
    .toggle("จันทร์สีเลือด", { defaultValue: ws.bloodMoon })
    .toggle("คาถาโดนผู้เล่นอื่น (PvP)", { defaultValue: ws.pvp })
    .toggle("พายุคลั่งเรียกสายฟ้าจริง (จุดไฟได้)", { defaultValue: ws.realLightning })
    .submitButton("บันทึก")
    .show(player)
    .then((res) => {
      if (res.canceled || !res.formValues) return;
      ws.bloodMoon = !!res.formValues[0];
      ws.pvp = !!res.formValues[1];
      ws.realLightning = !!res.formValues[2];
      saveWorldSettings(ws);
      if (!ws.bloodMoon && bloodMoonActive()) stopBloodMoon();
      tell(player, "§a✔ บันทึกการตั้งค่าโลกแล้ว");
    });
}

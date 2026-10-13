import { system, ItemStack } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { ALTAR_RECIPES, RUNES, RUNE_SOCKETS, RUNE_WEAPON_SUFFIX } from "./config.js";
import { getData } from "./data.js";
import { readRunes } from "./combat.js";
import { fx, COL, sound, psound } from "./fx.js";
import { V, countItem, consumeItem, giveStack, getMainhand, setMainhand, itemName, tell, isCreative, safe } from "./util.js";

const iconOf = (id) => (id.startsWith("arc:") ? `textures/items/arc_${id.slice(4)}` : undefined);

export function socketsOf(item) {
  if (!item) return 0;
  if (RUNE_SOCKETS[item.typeId]) return RUNE_SOCKETS[item.typeId];
  return RUNE_WEAPON_SUFFIX.some((s) => item.typeId.endsWith(s) || item.typeId.includes(s)) && item.maxAmount === 1 ? 1 : 0;
}

function runeLore(runes) {
  const byKey = Object.values(RUNES);
  return [
    "§r§7── รูน ──",
    ...runes.map((k) => {
      const r = byKey.find((x) => x.key === k);
      return r ? `§r${r.c}${r.glyph} ${r.name} §8— ${r.desc}` : k;
    }),
  ];
}

function writeRunes(item, runes) {
  item.setDynamicProperty("arc:runes", runes.join(","));
  const lore = item.getLore().filter((l) => !l.includes("── รูน ──") && !Object.values(RUNES).some((r) => l.includes(r.name)));
  item.setLore(runes.length ? [...lore, ...runeLore(runes)] : lore);
}

// ---------- โรงตีรูน ----------
function runeForge(player, block) {
  const item = getMainhand(player);
  const slots = socketsOf(item);
  if (!item || !slots) return infusionMenu(player, block);
  const runes = readRunes(item);
  const form = new ActionFormData().title("§d§lโรงตีรูน");
  form.body({
    rawtext: [
      { text: "§7อาวุธ: §f" }, itemName(item.typeId),
      { text: `\n§7ช่องรูน: §f${runes.length}/${slots}\n` },
      { text: runes.length ? runeLore(runes).slice(1).join("\n") : "§8(ยังไม่มีรูน)" },
      { text: "\n\n§8ใส่รูนลงอาวุธ: ตีศัตรูแล้วจะได้พลังรูนทันที" },
    ],
  });
  const actions = [];
  for (const [id, r] of Object.entries(RUNES)) {
    const have = countItem(player, id);
    if (!have) continue;
    const full = runes.length >= slots;
    const dup = runes.includes(r.key);
    form.button(`${r.c}${r.glyph} ใส่${r.name}§r\n§8${dup ? "ใส่ไว้แล้ว" : full ? "ช่องเต็ม" : `มี ${have} ชิ้น`}`, iconOf(id));
    actions.push(() => {
      if (dup || full) return tell(player, "§cใส่รูนนี้ไม่ได้");
      const cur = getMainhand(player);
      if (!cur || cur.typeId !== item.typeId) return tell(player, "§cต้องถืออาวุธเดิมไว้");
      if (!consumeItem(player, id, 1)) return;
      const now = readRunes(cur);
      now.push(r.key);
      writeRunes(cur, now);
      setMainhand(player, cur);
      forgeFx(player, block, COL.arcane);
      tell(player, `§d✦ ใส่${r.name}สำเร็จ!`);
    });
  }
  if (runes.length) {
    form.button("§cถอดรูนทั้งหมด\n§8(รูนจะแตกสลาย)", "textures/arc_ui/menu_locked");
    actions.push(() => {
      const cur = getMainhand(player);
      if (!cur || cur.typeId !== item.typeId) return;
      writeRunes(cur, []);
      setMainhand(player, cur);
      sound(player.dimension, "random.break", player.location, 1, 0.7);
    });
  }
  form.button("§5เปิดเมนูหลอมรวม (Infusion)", "textures/arc_ui/menu_spells");
  actions.push(() => infusionMenu(player, block));
  if (!Object.keys(RUNES).some((id) => countItem(player, id))) {
    form.body({ rawtext: [{ text: "§7ไม่มีรูนในกระเป๋า\n§8สร้างรูนได้จากเมนูหลอมรวม หรือหาในรอยแยก/บอส" }] });
  }
  form.show(player).then((res) => {
    if (!res.canceled && res.selection !== undefined) actions[res.selection]?.();
  });
}

// ---------- หลอมรวม ----------
function canMake(player, r) {
  return r.needs.every(([id, n]) => countItem(player, id) >= n);
}

function infusionMenu(player, block) {
  const d = getData(player);
  const list = [...ALTAR_RECIPES].sort((a, b) => Number(canMake(player, b)) - Number(canMake(player, a)) || a.level - b.level);
  const form = new ActionFormData().title("§5§lแท่นบูชาอาร์เคน").body("§7เลือกสิ่งที่ต้องการหลอมรวม\n§a✔ §7= วัตถุดิบครบ  §8✘ = ยังขาด");
  for (const r of list) {
    const ok = canMake(player, r);
    const lvlOk = d.lvl >= r.level;
    form.button({ rawtext: [{ text: ok && lvlOk ? "§a✔ §r" : "§8✘ " }, itemName(r.result), { text: `${r.count ? ` x${r.count}` : ""}\n§8ต้องการเลเวล ${r.level}${lvlOk ? "" : " §c(ยังไม่ถึง)"}` }] }, iconOf(r.result));
  }
  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    recipeDetail(player, block, list[res.selection]);
  });
}

function recipeDetail(player, block, r) {
  const d = getData(player);
  /** @type {any[]} */
  const lines = [{ text: "§7วัตถุดิบ:\n" }];
  for (const [id, n] of r.needs) {
    const have = countItem(player, id);
    lines.push({ text: `${have >= n ? "§a" : "§c"}${Math.min(have, n)}/${n} §f` }, itemName(id), { text: "\n" });
  }
  lines.push({ text: `\n§7เลเวลที่ต้องการ: ${d.lvl >= r.level ? "§a" : "§c"}${r.level}` });
  new MessageFormData()
    .title({ rawtext: [{ text: "§5" }, itemName(r.result)] })
    .body({ rawtext: lines })
    .button1("§lหลอมรวม")
    .button2("กลับ")
    .show(player)
    .then((res) => {
      if (res.canceled) return;
      if (res.selection === 1) return infusionMenu(player, block);
      if (d.lvl < r.level && !isCreative(player)) return tell(player, `§cต้องเลเวล ${r.level}`);
      if (!canMake(player, r)) return tell(player, "§cวัตถุดิบไม่ครบ");
      for (const [id, n] of r.needs) consumeItem(player, id, n);
      forgeFx(player, block, COL.void);
      system.runTimeout(() => {
        const stack = new ItemStack(r.result, r.count ?? 1);
        giveStack(player, stack);
        tell(player, { rawtext: [{ text: "§d✦ หลอมรวมสำเร็จ: §f" }, itemName(r.result)] });
      }, 30);
    });
}

function forgeFx(player, block, color) {
  const dim = block.dimension;
  const top = { x: block.x + 0.5, y: block.y + 1.1, z: block.z + 0.5 };
  sound(dim, "block.enchanting_table.use", top, 1, 0.8);
  psound(player, "random.anvil_use", 0.6, 1.4);
  let t = 0;
  const id = system.runInterval(() => {
    t += 3;
    fx.rune(dim, V.up(top, -0.05), 1.2 + t / 30, color, 0.3, 240);
    fx.line(dim, top, V.up(top, 3), color, 0.4, 0.2, 0.2);
    fx.swirl(dim, V.up(top, 0.4), color, 1.5, 4, 0.15);
    if (t >= 30) {
      system.clearRun(id);
      fx.burst(dim, V.up(top, 1), COL.gold, 30, 5);
      sound(dim, "random.levelup", top, 0.8, 1.6);
    }
  }, 3);
}

export const altarComponent = {
  onPlayerInteract(ev) {
    const player = ev.player;
    if (!player) return;
    const block = ev.block;
    system.run(() => safe(() => runeForge(player, block)));
  },
};

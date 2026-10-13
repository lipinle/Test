import { world, system } from "@minecraft/server";
import { SPELLS, STAFFS, G, xpToNext, MAX_LEVEL } from "./config.js";
import { getData } from "./data.js";
import { maxMana, lastXpPopup } from "./progression.js";
import { cdLeft, manaCost } from "./spells.js";
import { getMainhand, bar, fmt1 } from "./util.js";

// HUD บนแถบ actionbar: แถบมานา (ไอคอนฟอนต์ glyph_E5) + เลเวล + คาถาที่เลือก + คูลดาวน์
function manaBar(frac, glyph) {
  if (!glyph) return bar(frac, 20, "§b", "§8", "|");
  const segs = 10;
  const v = Math.max(0, Math.min(1, frac)) * segs;
  const full = Math.floor(v);
  const half = v - full >= 0.5 && full < segs ? 1 : 0;
  return G.MANA.repeat(full) + (half ? G.MANA_HALF : "") + G.MANA_EMPTY.repeat(segs - full - half);
}

function render(player) {
  const d = getData(player);
  if (!d.set.hud) return;
  const item = getMainhand(player);
  const staff = item && STAFFS[item.typeId] ? item : undefined;
  const holding = staff || item?.typeId === "arc:grimoire";
  const max = maxMana(player, d);
  const xpPop = lastXpPopup(player);
  if (!holding && d.mana >= max - 0.5 && !xpPop) return;
  const glyph = d.set.glyph;
  const lines = [];
  lines.push(`${manaBar(d.mana / max, glyph)} §b${Math.floor(d.mana)}§7/§b${max}`);
  const lvlTxt = d.lvl >= MAX_LEVEL ? "MAX" : `${Math.floor((d.xp / xpToNext(d.lvl)) * 100)}%`;
  let second = `§e${glyph ? G.STAR : "★"} §fLv ${d.lvl} §7${lvlTxt}`;
  if (staff) {
    const id = d.loadout[d.sel];
    const sp = id ? SPELLS[id] : undefined;
    if (sp) {
      const cd = cdLeft(player, id);
      const cost = manaCost(player, id, staff.typeId);
      second += `  ${glyph ? sp.glyph + " " : ""}§f${sp.name} §9(${cost}) ${cd > 0 ? `§c${fmt1(cd / 20)}s` : "§a✔"} §8[${d.sel + 1}]`;
    } else {
      second += "  §7ย่อตัว+ใช้คทา = เลือกคาถา";
    }
  }
  if (xpPop) second += `  §a+${xpPop} XP`;
  lines.push(second);
  try {
    player.onScreenDisplay.setActionBar(lines.join("\n"));
  } catch {}
}

export function initHud() {
  system.runInterval(() => {
    for (const p of world.getAllPlayers()) render(p);
  }, 4);
}

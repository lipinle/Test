// การต่อสู้: ดาเมจเพิ่มจากค่าสถานะ, เอฟเฟกต์ความชำนาญอาวุธ/เกราะ, XP จากการฆ่า

import { EntityDamageCause, ItemStack, Player, system, world } from "@minecraft/server";
import { BOSSES, DEFAULT_ANIMAL_XP, DEFAULT_MONSTER_XP, MOB_XP, statFx } from "./config.js";
import { getData, markDirty } from "./data.js";
import { addProfXp, addXp, skillOn } from "./progression.js";
import { armorCount, chance, enchantLevel, isCreative, mainhand, toolCategory } from "./util.js";

/** ใครตีมอนตัวนี้ล่าสุด — ใช้ให้ XP เมื่อมอนตายจากไฟ/เลือดออก/สายฟ้า */
const lastHit = new Map();

/** ไม่ลดดาเมจจากสาเหตุเหล่านี้ */
const NO_REDUCE = new Set([
  EntityDamageCause.void,
  EntityDamageCause.override,
  EntityDamageCause.selfDestruct,
  EntityDamageCause.starve,
]);

function health(entity) {
  try {
    return entity.getComponent("minecraft:health");
  } catch {
    return undefined;
  }
}

function heal(entity, amount) {
  const hp = health(entity);
  if (!hp || hp.currentValue <= 0 || amount <= 0) return;
  hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + amount));
}

/** ดาเมจเพิ่ม — ลดเลือดตรง ๆ ถ้าไม่ถึงตาย, ถ้าถึงตายใช้ applyDamage เพื่อให้นับว่าผู้เล่นฆ่า */
function dealBonus(target, amount, player, alreadyDealt) {
  if (amount <= 0.05 || !target.isValid) return;
  const hp = health(target);
  if (!hp || hp.currentValue <= 0) return;
  if (hp.currentValue - amount > 0.5) {
    hp.setCurrentValue(hp.currentValue - amount);
  } else {
    // ช่วงอมตะหลังโดนตี เกมจะหักเฉพาะส่วนที่เกินดาเมจครั้งก่อน จึงบวกดาเมจเดิมเข้าไปด้วย
    target.applyDamage(hp.currentValue + alreadyDealt + 10, {
      cause: EntityDamageCause.magic,
      damagingEntity: player,
    });
  }
}

function cooldownReady(player, id, ms) {
  const d = getData(player);
  const now = Date.now();
  if ((d.cd[id] ?? 0) > now) return false;
  d.cd[id] = now + ms;
  markDirty(player);
  return true;
}

function strikeLightning(target) {
  try {
    target.dimension.spawnEntity("minecraft:lightning_bolt", target.location);
  } catch {
    // ไม่เป็นไร
  }
}

// ---------------------------------------------------------------------------
// ผู้เล่นโจมตี
// ---------------------------------------------------------------------------

function onAttack(player, target, damage, cause, projectile) {
  const melee = cause === EntityDamageCause.entityAttack;
  const ranged = cause === EntityDamageCause.projectile;
  if (!melee && !ranged) return;
  if (!target.isValid) return;
  lastHit.set(target.id, { playerId: player.id, tick: system.currentTick });

  const d = getData(player);
  const s = d.stats;

  /** @type {"sword" | "axe" | "trident" | "bow" | undefined} */
  let weapon;
  if (melee) {
    const cat = toolCategory(mainhand(player));
    if (cat === "sword" || cat === "axe" || cat === "trident") weapon = cat;
  } else {
    const pid = projectile?.typeId;
    if (pid === "minecraft:thrown_trident") weapon = "trident";
    else if (pid === "minecraft:arrow") weapon = "bow";
  }
  const lv = weapon ? d.prof[weapon].level : 0;

  let mult = 1;
  let flat = melee ? statFx.meleeBonus(s) : 0;
  if (ranged) mult += statFx.projBonus(s);
  if (skillOn(player, "god")) mult += 0.2;
  let critChance = statFx.critChance(s);
  let lightningChance = 0;

  if (weapon === "sword") {
    if (lv >= 10) mult += 0.1;
    if (lv >= 50) critChance += 0.1;
  } else if (weapon === "axe") {
    if (lv >= 10) mult += 0.1;
    if (lv >= 50) mult += 0.25;
  } else if (weapon === "bow") {
    if (lv >= 10) mult += 0.15;
    if (lv >= 50) mult += 0.25;
  } else if (weapon === "trident") {
    if (lv >= 10) mult += 0.15;
    if (lv >= 50) mult += 0.3;
    if (ranged && lv >= 30) lightningChance = lv >= 50 ? 0.4 : 0.2;
  }

  let total = damage * mult + flat;
  let crit = false;
  if (chance(critChance)) {
    total *= statFx.critMult(s);
    crit = true;
  }
  if (weapon === "bow" && lv >= 40 && chance(0.2)) {
    total *= 1.5;
    crit = true;
  }

  const hp = health(target);
  let bonus = total - damage;
  // ประหาร (ดาบ Lv.50)
  if (weapon === "sword" && lv >= 50 && hp && !BOSSES.has(target.typeId)) {
    if (hp.currentValue - bonus < hp.effectiveMax * 0.15) {
      bonus = hp.currentValue + 1;
      player.onScreenDisplay.setActionBar("§4§lประหาร!");
    }
  }
  if (crit) player.onScreenDisplay.setActionBar(`§6§lคริติคอล! §r§e${total.toFixed(1)} ดาเมจ`);

  dealBonus(target, bonus, player, damage);

  // เอฟเฟกต์ติดเป้าหมาย
  if (target.isValid) {
    try {
      if (weapon === "sword" && lv >= 40 && chance(0.25)) target.addEffect("wither", 60, { amplifier: 0 });
      if (weapon === "axe" && lv >= 30) target.addEffect("weakness", 80, { amplifier: 0 });
      if (weapon === "axe" && lv >= 50 && chance(0.2)) target.addEffect("slowness", 40, { amplifier: 3 });
      if (weapon === "bow" && lv >= 30) target.addEffect("slowness", 60, { amplifier: 1 });
      if (weapon === "bow" && lv >= 50) target.setOnFire(5, true);
    } catch {
      // มอนบางตัวรับเอฟเฟกต์ไม่ได้
    }
  }
  if (lightningChance > 0 && chance(lightningChance)) strikeLightning(target);
  if (melee && skillOn(player, "thunder") && chance(0.1)) strikeLightning(target);

  // ดูดเลือด (ดาบ Lv.20)
  if (weapon === "sword" && lv >= 20) heal(player, total * 0.08);

  // ฟันกวาด (ดาบ Lv.30)
  if (weapon === "sword" && lv >= 30 && melee) {
    const around = player.dimension.getEntities({
      location: target.location,
      maxDistance: 3,
      families: ["monster"],
    });
    for (const e of around) {
      if (e.id === target.id || e.id === player.id) continue;
      lastHit.set(e.id, { playerId: player.id, tick: system.currentTick });
      e.applyDamage(Math.max(1, total * 0.35), { cause: EntityDamageCause.magic, damagingEntity: player });
    }
  }

  if (weapon) addProfXp(player, weapon, Math.min(20, Math.ceil(total)));
}

// ---------------------------------------------------------------------------
// ผู้เล่นถูกโจมตี
// ---------------------------------------------------------------------------

function onDefend(player, damage, cause, attacker) {
  if (damage <= 0 || NO_REDUCE.has(cause)) return;
  const hp = health(player);
  if (!hp || hp.currentValue <= 0) return; // ตายไปแล้ว

  const d = getData(player);
  const s = d.stats;
  const isHit = cause === EntityDamageCause.entityAttack || cause === EntityDamageCause.projectile;

  // ผู้ใช้สายฟ้าไม่โดนสายฟ้าของตัวเอง
  if (cause === EntityDamageCause.lightning && (skillOn(player, "thunder") || d.prof.trident.level >= 30)) {
    heal(player, damage);
    player.extinguishFire();
    return;
  }

  if (isHit && chance(statFx.dodge(s))) {
    heal(player, damage);
    player.onScreenDisplay.setActionBar("§b§lหลบได้!");
    player.playSound("mob.bat.takeoff", { volume: 0.6 });
    return;
  }

  const worn = armorCount(player);
  const armorLv = d.prof.armor.level;
  let reduction = statFx.reduction(s);
  if (worn > 0) {
    if (armorLv >= 40) reduction += 0.15;
    else if (armorLv >= 10) reduction += 0.05;
  }
  heal(player, damage * Math.min(0.8, reduction));

  const isExplosion = cause === EntityDamageCause.entityExplosion || cause === EntityDamageCause.blockExplosion;
  if (worn > 0 && (isHit || isExplosion)) addProfXp(player, "armor", Math.min(15, Math.ceil(damage)));

  // หนาม (เกราะ Lv.20)
  if (worn > 0 && armorLv >= 20 && cause === EntityDamageCause.entityAttack && attacker?.isValid && attacker.id !== player.id) {
    attacker.applyDamage(Math.max(1, damage * 0.2), { cause: EntityDamageCause.thorns, damagingEntity: player });
  }

  // ระบบฉุกเฉินตอนเลือดน้อย
  if (worn === 0 || hp.currentValue <= 0) return;
  const ratio = hp.currentValue / hp.effectiveMax;
  if (armorLv >= 50 && ratio < 0.2 && cooldownReady(player, "laststand", 300_000)) {
    hp.setCurrentValue(hp.effectiveMax * 0.5);
    player.addEffect("resistance", 100, { amplifier: 2 });
    player.onScreenDisplay.setTitle("§c§lไม่ยอมตาย!", { subtitle: "§7ฟื้นเลือด 50%", fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 10 });
    player.playSound("random.totem", { volume: 0.7 });
  } else if (armorLv >= 30 && ratio < 0.3 && cooldownReady(player, "absorb", 60_000)) {
    player.addEffect("absorption", 200, { amplifier: 1 });
    player.onScreenDisplay.setActionBar("§e§lโล่ฉุกเฉินทำงาน!");
  }
}

// ---------------------------------------------------------------------------
// XP จากการฆ่า
// ---------------------------------------------------------------------------

function mobXp(entity, typeId) {
  if (MOB_XP[typeId] !== undefined) return MOB_XP[typeId];
  try {
    if (entity.getComponent("minecraft:type_family")?.hasTypeFamily("monster")) return DEFAULT_MONSTER_XP;
  } catch {
    // entity ตายแล้วอาจอ่านไม่ได้
  }
  return DEFAULT_ANIMAL_XP;
}

export function initCombat() {
  world.afterEvents.entityHurt.subscribe((ev) => {
    const { hurtEntity, damage, damageSource } = ev;
    const attacker = damageSource.damagingEntity;
    try {
      if (attacker instanceof Player && attacker.id !== hurtEntity.id) {
        onAttack(attacker, hurtEntity, damage, damageSource.cause, damageSource.damagingProjectile);
      }
      if (hurtEntity instanceof Player) onDefend(hurtEntity, damage, damageSource.cause, attacker);
    } catch {
      // entity หายไประหว่างทาง
    }
  });

  world.afterEvents.entityDie.subscribe((ev) => {
    const dead = ev.deadEntity;
    let typeId, deadId;
    try {
      typeId = dead.typeId;
      deadId = dead.id;
    } catch {
      return;
    }
    let killer = ev.damageSource.damagingEntity;
    const rec = lastHit.get(deadId);
    lastHit.delete(deadId);
    if (!(killer instanceof Player) && rec && system.currentTick - rec.tick < 300) {
      killer = world.getEntity(rec.playerId);
    }
    if (!(killer instanceof Player) || killer.id === deadId) return;
    addXp(killer, mobXp(dead, typeId));
  });

  // ธนู Lv.20: 30% ได้ลูกธนูคืน
  world.afterEvents.itemReleaseUse.subscribe((ev) => {
    const player = ev.source;
    if (ev.itemStack?.typeId !== "minecraft:bow" || isCreative(player)) return;
    if (enchantLevel(ev.itemStack, "infinity") > 0) return;
    if (getData(player).prof.bow.level < 20 || !chance(0.3)) return;
    const inv = player.getComponent("minecraft:inventory")?.container;
    const left = inv?.addItem(new ItemStack("minecraft:arrow", 1));
    if (left) player.dimension.spawnItem(left, player.location);
  });

  // ล้างข้อมูลเก่า
  system.runInterval(() => {
    const now = system.currentTick;
    for (const [id, rec] of lastHit) if (now - rec.tick > 600) lastHit.delete(id);
  }, 600);
}

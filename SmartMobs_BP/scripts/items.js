// ไอเท็มพิเศษจากบอส: ดาบดูดเลือด, ขวานฟันกวาด, อุปกรณ์ไททัน, คทาสายฟ้า, ไข่มุกมิติ,
// เครื่องรางวิญญาณ, กะโหลกต้องสาป

import { EntityDamageCause, EquipmentSlot, GameMode, Player, system } from "@minecraft/server";
import {
  DOOM_AXE_CLEAVE,
  DOOM_AXE_RADIUS,
  KINGSLAYER_LIFESTEAL,
  LEGENDARY_WEAR_CHANCE,
  SOUL_CHARM_EFFECTS,
  THUNDER_COOLDOWN,
  THUNDER_DAMAGE,
  THUNDER_RANGE,
  VOID_PEARL_COOLDOWN,
  VOID_PEARL_RANGE,
} from "./config.js";
import { summonBossNear } from "./boss.js";
import { chance } from "./util.js";

const KINGSLAYER = "smartmobs:kingslayer";
const DOOM_AXE = "smartmobs:doom_axe";
const TITAN_TOOLS = new Set(["smartmobs:titan_pickaxe", "smartmobs:titan_shovel", DOOM_AXE]);
const THUNDER_STAFF = "smartmobs:thunder_staff";
const VOID_PEARL = "smartmobs:void_pearl";
const SOUL_CHARM = "smartmobs:soul_charm";
const CURSED_SKULL = "smartmobs:cursed_skull";

/** `${player.id}:${item}` -> tick ที่ใช้ได้อีกครั้ง */
const useCooldown = new Map();

function equippable(player) {
  return player.getComponent("minecraft:equippable");
}

function creative(player) {
  return player.getGameMode() === GameMode.Creative;
}

/**
 * ลดความทนทานไอเท็มในมือหลัก
 * @param {number} amount ลดกี่หน่วย
 * @param {number} odds   โอกาสที่จะลด (คิด Unbreaking ด้วย)
 */
function wear(player, amount, odds) {
  if (creative(player)) return;
  const eq = equippable(player);
  const item = eq?.getEquipment(EquipmentSlot.Mainhand);
  const dur = item?.getComponent("minecraft:durability");
  if (!dur) return;
  let unbreaking = 0;
  try {
    unbreaking = item.getComponent("minecraft:enchantable")?.getEnchantment("unbreaking")?.level ?? 0;
  } catch {
    // ไม่เป็นไร
  }
  if (!chance(odds / (unbreaking + 1))) return;
  if (dur.damage + amount >= dur.maxDurability) {
    eq.setEquipment(EquipmentSlot.Mainhand, undefined);
    player.playSound("random.break");
    return;
  }
  dur.damage += amount;
  eq.setEquipment(EquipmentSlot.Mainhand, item);
}

function onCooldown(player, item, ticks) {
  const k = `${player.id}:${item}`;
  const now = system.currentTick;
  const until = useCooldown.get(k) ?? 0;
  if (until > now) {
    player.onScreenDisplay.setActionBar(`§7รออีก ${((until - now) / 20).toFixed(1)} วินาที`);
    return true;
  }
  useCooldown.set(k, now + ticks);
  return false;
}

// ---------------------------------------------------------------------------
// ตี / ขุด
// ---------------------------------------------------------------------------

/** @param {import("@minecraft/server").EntityHurtAfterEvent} ev */
export function onItemHit(ev) {
  const player = ev.damageSource.damagingEntity;
  if (!(player instanceof Player) || ev.damageSource.cause !== EntityDamageCause.entityAttack) return;
  const type = equippable(player)?.getEquipment(EquipmentSlot.Mainhand)?.typeId;
  if (type !== KINGSLAYER && type !== DOOM_AXE) return;
  const victim = ev.hurtEntity;

  if (type === KINGSLAYER) {
    const hp = player.getComponent("minecraft:health");
    if (hp && hp.currentValue > 0) {
      hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + ev.damage * KINGSLAYER_LIFESTEAL));
    }
  } else {
    // ฟันกวาดเฉพาะมอนสเตอร์ ไม่โดนสัตว์เลี้ยง/ผู้เล่น
    const others = victim.dimension.getEntities({
      location: victim.location,
      maxDistance: DOOM_AXE_RADIUS,
      families: ["monster"],
    });
    for (const e of others) {
      if (e.id === victim.id) continue;
      try {
        e.applyDamage(ev.damage * DOOM_AXE_CLEAVE, { cause: EntityDamageCause.magic, damagingEntity: player });
      } catch {
        // ไม่เป็นไร
      }
    }
    if (others.length > 1) {
      try {
        victim.dimension.spawnParticle("minecraft:critical_hit_emitter", victim.location);
      } catch {
        // ไม่เป็นไร
      }
    }
  }
  wear(player, 1, LEGENDARY_WEAR_CHANCE);
}

/** @param {import("@minecraft/server").PlayerBreakBlockAfterEvent} ev */
export function onItemBreakBlock(ev) {
  const type = ev.itemStackBeforeBreak?.typeId;
  if (type && TITAN_TOOLS.has(type)) wear(ev.player, 1, LEGENDARY_WEAR_CHANCE);
}

// ---------------------------------------------------------------------------
// กดใช้
// ---------------------------------------------------------------------------

function thunder(player) {
  const eye = player.getHeadLocation();
  let target;
  let pos;
  try {
    const hit = player.getEntitiesFromViewDirection({ maxDistance: THUNDER_RANGE }).find((h) => h.entity.id !== player.id);
    if (hit) {
      target = hit.entity;
      pos = target.location;
    }
  } catch {
    // ไม่เป็นไร
  }
  if (!pos) {
    const hit = player.getBlockFromViewDirection({ maxDistance: THUNDER_RANGE });
    if (hit) pos = { x: hit.block.location.x + 0.5, y: hit.block.location.y + 1, z: hit.block.location.z + 0.5 };
  }
  if (!pos) {
    player.onScreenDisplay.setActionBar("§7ไม่มีเป้าหมายในระยะ");
    return false;
  }
  if (Math.hypot(pos.x - eye.x, pos.z - eye.z) < 5) {
    player.onScreenDisplay.setActionBar("§cเป้าหมายใกล้เกินไป (ต้องห่าง 5 บล็อกขึ้นไป)");
    return false;
  }
  player.dimension.spawnEntity("minecraft:lightning_bolt", pos);
  if (target?.isValid) {
    try {
      target.applyDamage(THUNDER_DAMAGE, { cause: EntityDamageCause.lightning, damagingEntity: player });
    } catch {
      // ไม่เป็นไร
    }
  }
  return true;
}

function voidWarp(player) {
  const eye = player.getHeadLocation();
  const dir = player.getViewDirection();
  const hit = player.getBlockFromViewDirection({ maxDistance: VOID_PEARL_RANGE });
  const candidates = [];
  if (hit) {
    const b = hit.block.location;
    candidates.push({ x: b.x + 0.5, y: b.y + 1, z: b.z + 0.5 });
    for (const back of [1, 2, 3]) {
      const d = Math.max(0, hit.distance ?? dist(eye, b)) - back;
      candidates.push({ x: eye.x + dir.x * d, y: eye.y + dir.y * d - 1.6, z: eye.z + dir.z * d });
    }
  } else {
    const d = VOID_PEARL_RANGE;
    candidates.push({ x: eye.x + dir.x * d, y: eye.y + dir.y * d - 1.6, z: eye.z + dir.z * d });
  }
  const from = player.location;
  for (const c of candidates) {
    try {
      if (player.tryTeleport(c, { checkForBlocks: true, keepVelocity: false })) {
        player.addEffect("slow_falling", 40, { amplifier: 0, showParticles: false });
        player.dimension.playSound("mob.endermen.portal", from);
        player.dimension.playSound("mob.endermen.portal", c);
        return true;
      }
    } catch {
      // ลองตำแหน่งถัดไป
    }
  }
  player.onScreenDisplay.setActionBar("§7วาร์ปไปตรงนั้นไม่ได้");
  return false;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function consumeOne(player) {
  if (creative(player)) return;
  const eq = equippable(player);
  const item = eq?.getEquipment(EquipmentSlot.Mainhand);
  if (!item || item.typeId !== CURSED_SKULL) return;
  if (item.amount <= 1) {
    eq.setEquipment(EquipmentSlot.Mainhand, undefined);
  } else {
    item.amount -= 1;
    eq.setEquipment(EquipmentSlot.Mainhand, item);
  }
}

/** @param {import("@minecraft/server").ItemUseAfterEvent} ev */
export function onItemUse(ev) {
  const player = ev.source;
  const type = ev.itemStack?.typeId;
  if (!(player instanceof Player)) return;
  switch (type) {
    case THUNDER_STAFF:
      if (onCooldown(player, type, THUNDER_COOLDOWN)) return;
      if (thunder(player)) wear(player, 1, 1);
      break;
    case VOID_PEARL:
      if (onCooldown(player, type, VOID_PEARL_COOLDOWN)) return;
      if (voidWarp(player)) wear(player, 1, 1);
      break;
    case CURSED_SKULL:
      if (onCooldown(player, type, 40)) return;
      try {
        summonBossNear(player);
        consumeOne(player);
      } catch {
        player.sendMessage("§cเรียกบอสตรงนี้ไม่ได้");
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// เครื่องรางวิญญาณ (ทุก 1 วินาที)
// ---------------------------------------------------------------------------

export function charmTick(players) {
  for (const player of players) {
    try {
      if (equippable(player)?.getEquipment(EquipmentSlot.Offhand)?.typeId !== SOUL_CHARM) continue;
      for (const fx of SOUL_CHARM_EFFECTS) {
        player.addEffect(fx.id, 60, { amplifier: fx.amp, showParticles: false });
      }
    } catch {
      // ไม่เป็นไร
    }
  }
}

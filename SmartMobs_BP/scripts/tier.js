// คำนวณระดับความเก่งของมอนจากจำนวนวันในโลก + บังคับระดับสำหรับทดสอบ

import { world } from "@minecraft/server";
import { TIERS } from "./config.js";

const FORCE_KEY = "smartmobs:forceTier";

export function currentDay() {
  try {
    return world.getDay();
  } catch {
    return Math.floor(world.getAbsoluteTime() / 24000);
  }
}

/** ระดับที่บังคับไว้ด้วยคำสั่ง หรือ -1 ถ้าใช้ตามวัน */
export function forcedTier() {
  const v = world.getDynamicProperty(FORCE_KEY);
  return typeof v === "number" ? v : -1;
}

export function setForcedTier(tier) {
  world.setDynamicProperty(FORCE_KEY, tier < 0 ? undefined : Math.min(tier, TIERS.length - 1));
}

export function tierForDay(day) {
  let t = 0;
  for (let i = 0; i < TIERS.length; i++) if (day >= TIERS[i].day) t = i;
  return t;
}

export function currentTierIndex() {
  const f = forcedTier();
  return f >= 0 ? f : tierForDay(currentDay());
}

export function currentTier() {
  return TIERS[currentTierIndex()];
}

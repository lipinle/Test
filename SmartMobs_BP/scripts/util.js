// ฟังก์ชันช่วยที่ใช้หลายไฟล์

import { GameMode, world } from "@minecraft/server";

export const chance = (p) => p > 0 && Math.random() < p;
export const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
export const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function isSurvival(player) {
  const mode = player.getGameMode();
  return mode === GameMode.Survival || mode === GameMode.Adventure;
}

export function isNight() {
  const t = world.getTimeOfDay();
  return t >= 12500 && t <= 23500;
}

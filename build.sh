#!/bin/sh
# สร้างไฟล์ .mcaddon ของทุก addon สำหรับนำเข้าเกม
set -e
cd "$(dirname "$0")"
for pack in SurvivalFlight SmeltedOreBlocks GearEffects SwordSweep RPGLevels SmartMobs MegaStack SpearMastery ArcaneAscension; do
  rm -f "$pack.mcaddon"
  if [ -d "${pack}_RP" ]; then
    zip -r "$pack.mcaddon" "${pack}_BP" "${pack}_RP" -x '*.DS_Store'
  else
    zip -r "$pack.mcaddon" "${pack}_BP" -x '*.DS_Store'
  fi
  echo "สร้าง $pack.mcaddon เรียบร้อย"
done

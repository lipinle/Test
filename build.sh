#!/bin/sh
# สร้างไฟล์ .mcaddon ของทุก addon สำหรับนำเข้าเกม
set -e
cd "$(dirname "$0")"
for pack in SurvivalFlight SmeltedOreBlocks GearEffects SwordSweep ItemMagnet; do
  rm -f "$pack.mcaddon"
  dirs="${pack}_BP"
  [ -d "${pack}_RP" ] && dirs="$dirs ${pack}_RP"
  zip -r "$pack.mcaddon" $dirs -x '*.DS_Store'
  echo "สร้าง $pack.mcaddon เรียบร้อย"
done

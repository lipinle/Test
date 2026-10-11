#!/bin/sh
# สร้างไฟล์ .mcaddon ของทุก addon สำหรับนำเข้าเกม
set -e
cd "$(dirname "$0")"
for pack in SurvivalFlight SmeltedOreBlocks; do
  rm -f "$pack.mcaddon"
  zip -r "$pack.mcaddon" "${pack}_BP" -x '*.DS_Store'
  echo "สร้าง $pack.mcaddon เรียบร้อย"
done

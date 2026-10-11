#!/bin/sh
# สร้างไฟล์ SurvivalFlight.mcaddon สำหรับนำเข้าเกม
set -e
cd "$(dirname "$0")"
rm -f SurvivalFlight.mcaddon
zip -r SurvivalFlight.mcaddon SurvivalFlight_BP -x '*.DS_Store'
echo "สร้าง SurvivalFlight.mcaddon เรียบร้อย"

# 🔒 運用固定メモ（絶対守る）

## 🟢 作業開始（必ずSTG）
git checkout stg
git pull

# 修正後
git add -A
git commit -m "stg: update"
git push

---

## 🔵 本番へ反映
git checkout main
git pull --rebase origin main
git merge stg
git push

---

## 🔴 本番メンテ切替（mainでやる）
MAINTENANCE_MODE = true  → メンテON
MAINTENANCE_MODE = false → 公開

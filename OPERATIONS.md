# 🔒 運用固定メモ（絶対守る）

────────────────────
🟢 ① 作業開始（必ずSTG）
────────────────────
git checkout stg
git pull

# 修正後
git add -A
git commit -m "stg: update"
git push


────────────────────
🔵 ② 本番へ反映（STG → main）
────────────────────
git checkout main
git pull --rebase origin main
git merge stg
git push


────────────────────
🔴 ③ 本番メンテON（公開停止）
────────────────────
git checkout main
git pull

# index.html の
MAINTENANCE_MODE = true に変更

git add -A
git commit -m "maintenance on"
git push


────────────────────
🟢 ④ 本番メンテOFF（公開再開）
────────────────────
git checkout main
git pull

# index.html の
MAINTENANCE_MODE = false に変更

git add -A
git commit -m "maintenance off"
git push

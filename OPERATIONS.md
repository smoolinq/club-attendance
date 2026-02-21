🟢 ① 更新main
────────────────────
git checkout main
git pull origin main
git merge <your-branch>
git push origin main


────────────────────
🔴 ③ 本番メンテON（公開停止）
────────────────────
git status
sed -i '' 's/const MAINTENANCE_MODE = false;/const MAINTENANCE_MODE = true;/' index.html
grep -n "MAINTENANCE_MODE" index.html
git add index.html
git commit -m "Maintenance ON"
git push origin main


────────────────────
🟢 ④ 本番メンテOFF（公開再開）
────────────────────
git status
sed -i '' 's/const MAINTENANCE_MODE = true;/const MAINTENANCE_MODE = false;/' index.html
grep -n "MAINTENANCE_MODE" index.html
git add index.html
git commit -m "Maintenance OFF"
git push origin main
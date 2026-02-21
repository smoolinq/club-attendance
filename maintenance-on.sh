#!/bin/bash
git status
sed -i '' 's/const MAINTENANCE_MODE = false;/const MAINTENANCE_MODE = true;/' index.html
grep -n "MAINTENANCE_MODE" index.html
git add index.html
git commit -m "Maintenance ON"
git push origin main
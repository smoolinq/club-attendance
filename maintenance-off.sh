#!/bin/bash

git status
sed -i '' 's/const MAINTENANCE_MODE = true;/const MAINTENANCE_MODE = false;/' index.html
grep -n "MAINTENANCE_MODE" index.html
git add index.html
git commit -m "Maintenance OFF"
git push origin main
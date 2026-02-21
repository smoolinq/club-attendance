#!/bin/bash

git checkout main

sed -i '' 's/MAINTENANCE_MODE = false/MAINTENANCE_MODE = true/' index.html

git add -A
git commit -m "maintenance on"
git push

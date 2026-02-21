#!/bin/bash

git checkout main

sed -i '' 's/MAINTENANCE_MODE = true/MAINTENANCE_MODE = false/' index.html

git add -A
git commit -m "maintenance off"
git push


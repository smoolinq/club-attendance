#!/bin/bash
PORT=8080
DIR="$(cd "$(dirname "$0")" && pwd)"
python3 -m http.server "$PORT" -d "$DIR" &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT
echo "⏳ トンネル接続中..."
cloudflared tunnel --url "http://localhost:$PORT"

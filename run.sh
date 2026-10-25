#!/usr/bin/env bash
# Serve Saathi locally so the browser treats it as a normal http origin
# (needed for clipboard access and for providers' CORS checks).
set -e
cd "$(dirname "$0")"
PORT="${1:-8000}"
echo "Saathi -> http://localhost:$PORT"
exec python3 -m http.server "$PORT"

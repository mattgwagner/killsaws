#!/usr/bin/env bash
# Render all 25 bots and montage them: e2e/sheet.sh <url> <out.png>
set -euo pipefail
url=${1:-http://localhost:5180}; out=${2:-sheet.png}
dir=$(mktemp -d)
node "$(dirname "$0")/gallery.mjs" "$url" "$dir"
cd "$dir"
magick montage -label '%t' *.png -tile 5x -geometry 360x240+2+2 -background '#000' -fill '#f2c400' -pointsize 16 "$out"
echo "$out"

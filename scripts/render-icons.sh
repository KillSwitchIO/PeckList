#!/usr/bin/env bash
# Render web/public/icon.svg to PNGs at common sizes in web/public/icons: the web manifest (192,
# 512), the Apple touch icon (180), a PNG favicon (32), and app stores or docs (16 to 1024).
# Run it again after changing icon.svg, and commit the PNGs. Needs Inkscape 1.x.
set -euo pipefail
cd "$(dirname "$0")/../web/public"
mkdir -p icons
for size in 16 32 48 64 96 128 180 192 256 512 1024; do
  inkscape icon.svg --export-type=png --export-filename="icons/icon-$size.png" -w "$size" -h "$size"
done
# The maskable icon, for launchers that crop to their own shape.
inkscape icon-maskable.svg --export-type=png --export-filename=icons/icon-maskable-512.png -w 512 -h 512

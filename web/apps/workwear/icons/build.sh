#!/bin/sh
# Draws the favicon and home-screen icons in public/ from public/favicon.svg and
# the two sources here (Gavort's emblem, as in src/components/gavort-logo.tsx).
# Needs rsvg-convert (brew install librsvg). Run from anywhere; commit the PNGs.
set -eu
cd "$(dirname "$0")/.."
rsvg-convert -w 32 public/favicon.svg -o public/favicon-32.png
rsvg-convert -w 180 icons/app-icon.svg -o public/apple-touch-icon.png
rsvg-convert -w 192 icons/app-icon.svg -o public/icon-192.png
rsvg-convert -w 512 icons/app-icon.svg -o public/icon-512.png
rsvg-convert -w 512 icons/app-icon-maskable.svg -o public/icon-maskable-512.png

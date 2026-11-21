#!/usr/bin/env bash
#
# dev/calendar-shots.sh -- render the three calendar widgets at three widths, light and dark.
#
# Needs the shot bundle: gjsify build dev/calendar-shot.ts --app gjs --outfile dist/calendar-shot.gjs.mjs
# Output: /tmp/gjsify-cal-<widget>-<width>-<light|dark>.png
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
HEADLESS="${HEADLESS_RUN:?set HEADLESS_RUN to a headless-session wrapper that takes --window-shot}"
WIDGETS=${WIDGETS:-"month time agenda"}
WIDTHS=${WIDTHS:-"360 720 1200"}
SCHEMES=${SCHEMES:-"light dark"}

cd "$HERE"
[ -f dist/calendar-shot.gjs.mjs ] || { echo "no dist/calendar-shot.gjs.mjs: build it first" >&2; exit 1; }

for widget in $WIDGETS; do
  for width in $WIDTHS; do
    height=700
    [ "$width" = 360 ] && height=740
    for scheme in $SCHEMES; do
      file="/tmp/gjsify-cal-$widget-$width-$scheme.png"
      rm -f "$file"
      dark=()
      [ "$scheme" = dark ] && dark=(--dark)
      # headless-run may exit non-zero even when the image is written, so the file is the verdict.
      env CAL_SHOT_WIDGET="$widget" CAL_SHOT_WIDTH="$width" CAL_SHOT_HEIGHT="$height" \
        LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 \
        timeout 170 "$HEADLESS" --size 1600x1100 "${dark[@]}" --shot-delay 5 --window-shot "$file" -- \
        gjsify run dist/calendar-shot.gjs.mjs >"/tmp/gjsify-cal-$widget-$width-$scheme.log" 2>&1
      if [ -s "$file" ]; then echo "ok   $file"; else echo "FAIL $file" >&2; fi
    done
  done
done

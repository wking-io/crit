#!/bin/sh
set -eu

CRIT="${CRIT:-node packages/cli/dist/main.js}"
CANVAS="canvas_performance_lab_v2"

if $CRIT open "$CANVAS" >/dev/null 2>&1; then
  echo "$CANVAS already exists"
  exit 0
fi

$CRIT create "$CANVAS" --title "Canvas performance lab"
$CRIT add-frame "$CANVAS" --type applicationRoute --route /ui/prototypes/eyes-randomized --title "Randomized Eye Systems" --x 80 --y 980 --width 1280 --height 900
$CRIT add-frame "$CANVAS" --type applicationRoute --route /ui/prototypes/eyes-art-directed --title "Art-directed Eye Systems" --x 1440 --y 980 --width 1280 --height 900
$CRIT add-frame "$CANVAS" --type applicationRoute --route /ui/prototypes/pattern-directions --title "Three Pattern Directions" --x 2800 --y 980 --width 1280 --height 900
$CRIT add-frame "$CANVAS" --type applicationRoute --route /ui/prototypes/pattern-color-mixing --title "Mixed-color Pattern Study" --x 4160 --y 980 --width 1280 --height 900
$CRIT add-frame "$CANVAS" --type applicationRoute --route /pattern-review-prototype.html --title "Woven Pattern Family Review" --x 5520 --y 980 --width 1440 --height 1000
$CRIT add-frame "$CANVAS" --type applicationRoute --route /pattern-review-prototype-v2.html --title "Woven Pattern Density Review" --x 7040 --y 980 --width 1440 --height 1000
$CRIT add-frame "$CANVAS" --type applicationRoute --route /pattern-review-prototype-v3.html --title "Woven Pattern Character Review" --x 8560 --y 980 --width 1440 --height 1000
echo "Seeded $CANVAS"

#!/usr/bin/env bash
#
# Panova build script
# Usage: bash ~/.claude/skills/panova/build.sh <input.md> [output.html]
#
# Reads markdown + style.css + render.js, assembles into a self-contained HTML report.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$SCRIPT_DIR/template.html"
STYLE="$SCRIPT_DIR/style.css"
JS="$SCRIPT_DIR/render.js"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <input.md> [output.html]"
  exit 1
fi

INPUT="$1"
OUTPUT="${2:-./panova-report.html}"

for f in "$INPUT" "$TEMPLATE" "$STYLE" "$JS"; do
  if [ ! -f "$f" ]; then echo "Error: file not found: $f"; exit 1; fi
done

python3 - "$INPUT" "$STYLE" "$JS" "$TEMPLATE" "$OUTPUT" <<'PYEOF'
import sys

# Read and escape markdown for JS template literal
with open(sys.argv[1], 'r') as f:
    md = f.read()
md = md.replace('\\', '\\\\')
md = md.replace('`', '\\`')
md = md.replace('${', '\\${')

# Read CSS
with open(sys.argv[2], 'r') as f:
    style = f.read()

# Read JS, inject markdown
with open(sys.argv[3], 'r') as f:
    js = f.read()
js = js.replace('__REPORT_CONTENT__', md)

# Read template, inject style and JS
with open(sys.argv[4], 'r') as f:
    tpl = f.read()
result = tpl.replace('__STYLES__', style).replace('__SCRIPTS__', js)

with open(sys.argv[5], 'w') as f:
    f.write(result)
PYEOF

echo "Report generated: $OUTPUT"

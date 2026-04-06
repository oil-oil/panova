#!/usr/bin/env bash
#
# Panova build script
# Usage: bash ~/.claude/skills/panova/build.sh <input.md> [output.html]
#
# Reads markdown + style.css + render.js, assembles into a self-contained HTML report.
# Includes post-build JS validation.

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
import sys, re

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

# --- Post-build validation ---
echo "Validating..."

ERRORS=0

# 1. Extract JS from HTML and check syntax with node
python3 - "$OUTPUT" <<'VALIDATE_PYEOF'
import sys, re

with open(sys.argv[1], 'r') as f:
    content = f.read()

# Extract all inline <script> blocks (skip ones with src=)
scripts = re.findall(r'<script(?:\s[^>]*)?>(?!<)(.*?)</script>', content, re.DOTALL)
# Filter out empty and src-only scripts
js_blocks = [s for s in scripts if s.strip()]

if not js_blocks:
    print("Warning: No inline JS found in HTML")
    sys.exit(0)

# Write combined JS for syntax check
combined = '\n'.join(js_blocks)
with open('/tmp/panova-validate.js', 'w') as f:
    f.write(combined)
VALIDATE_PYEOF

if [ -f /tmp/panova-validate.js ]; then
  if ! node -c /tmp/panova-validate.js 2>/tmp/panova-validate-err.txt; then
    echo "ERROR: JS syntax error in generated HTML:"
    cat /tmp/panova-validate-err.txt
    ERRORS=$((ERRORS + 1))
  fi
  rm -f /tmp/panova-validate.js /tmp/panova-validate-err.txt
fi

# 2. Check for dangerous patterns: literal </script> inside the JS content
python3 - "$OUTPUT" <<'CHECK_PYEOF'
import sys, re

with open(sys.argv[1], 'r') as f:
    content = f.read()

# Find <script>...</script> blocks and check for premature </script> inside
scripts = list(re.finditer(r'<script(?:\s[^>]*)?>(?!<)(.*?)</script>', content, re.DOTALL))
for i, m in enumerate(scripts):
    body = m.group(1)
    # Check if body contains </script (case insensitive) which would break parsing
    inner_matches = list(re.finditer(r'</script', body, re.IGNORECASE))
    if inner_matches:
        for im in inner_matches:
            line = content[:m.start() + im.start()].count('\n') + 1
            print(f"ERROR: Found literal </script inside <script> block at line {line}")
        sys.exit(1)

# Check for unescaped backticks in template literal
raw_match = re.search(r'const RAW = `(.*?)(?<!\\)`', content, re.DOTALL)
if raw_match:
    raw_content = raw_match.group(1)
    # Check for unescaped backticks (backtick not preceded by backslash)
    for i, ch in enumerate(raw_content):
        if ch == '`' and (i == 0 or raw_content[i-1] != '\\'):
            line = content[:raw_match.start() + i].count('\n') + 1
            print(f"ERROR: Unescaped backtick in template literal at line {line}")
            sys.exit(1)
    # Check for unescaped ${
    for m2 in re.finditer(r'(?<!\\)\$\{', raw_content):
        line = content[:raw_match.start() + m2.start()].count('\n') + 1
        print(f"ERROR: Unescaped ${{ in template literal at line {line}")
        sys.exit(1)

print("OK: No dangerous patterns found")
CHECK_PYEOF

if [ $? -ne 0 ]; then
  ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -gt 0 ]; then
  echo "Build completed with $ERRORS validation error(s). Report may not work correctly."
  exit 1
else
  echo "Validation passed."
fi

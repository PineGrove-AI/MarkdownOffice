#!/usr/bin/env bash
# Smoke test: render README.md to a PDF and to slides using the placeholder
# config and logo in test/fixture, then sanity-check the output.
#
#   deno task test            # run the checks
#   deno task test --open     # ...and open both outputs
#
# Output goes to test/out/ (git-ignored).
set -euo pipefail

cd "$(dirname "$0")/.." > /dev/null
FIXTURE="test/fixture"
OUT="test/out"
OPEN="${1:-}"

# Only use the fixture config/logo, never the user's global ~/.config/mdo
export XDG_CONFIG_HOME="$PWD/$OUT/config"

rm -rf "$OUT"
mkdir -p "$OUT"

failures=0
ok()   { printf '  ✓ %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*"; failures=$((failures + 1)); }

mdo() { deno run -A main.ts "$@" --root "$FIXTURE"; }

# ── PDF ─────────────────────────────────────────────────────────────────
echo "PDF"
if mdo pdf README.md --output "$OUT/README.pdf" > "$OUT/pdf.log" 2>&1; then
  if [ "$(head -c 4 "$OUT/README.pdf")" = "%PDF" ]; then
    ok "README.pdf ($(wc -c < "$OUT/README.pdf" | tr -d ' ') bytes)"
  else
    fail "README.pdf is not a PDF"
  fi
else
  fail "mdo pdf failed (see $OUT/pdf.log)"; tail -5 "$OUT/pdf.log"
fi

# ── Slides ──────────────────────────────────────────────────────────────
echo "Slides"
# In a subfolder, so the slides PDF doesn't clash with the document PDF
HTML="$OUT/slides/README.html"
SLIDES_PDF="$OUT/slides/README.pdf"
if mdo slides README.md --output "$HTML" --pdf > "$OUT/slides.log" 2>&1; then
  slides=$(grep -o '<section class="slide' "$HTML" | wc -l | tr -d ' ')
  if [ "$slides" -ge 10 ]; then ok "README.html has $slides slides"; else fail "only $slides slides in README.html"; fi

  if grep -q -- '--brand-deep: *#2563EB' "$HTML"; then ok "brand colour from fixture config"; else fail "brand colour missing"; fi
  if grep -q 'data:image/svg+xml;base64' "$HTML"; then ok "fixture logo embedded"; else fail "logo not embedded"; fi
  if grep -q '<script type="module">' "$HTML"; then ok "navigation script inlined"; else fail "navigation script missing"; fi
  if grep -qE '(src|href)="/_astro/' "$HTML"; then fail "references external /_astro/ assets"; else ok "self-contained (no /_astro/ assets)"; fi
  if grep -q '▲' "$OUT/slides.log"; then fail "warnings during build:"; grep '▲' "$OUT/slides.log"; fi

  # --pdf: one 16:9 page per slide
  if [ "$(head -c 4 "$SLIDES_PDF" 2>/dev/null)" = "%PDF" ]; then
    # Page objects are "/Type /Page" (not "/Pages"), often at the end of a line
    pages=$( (grep -aoE '/Type ?/Page([^s]|$)' "$SLIDES_PDF" || true) | wc -l | tr -d ' ')
    if [ "$pages" -eq "$slides" ]; then ok "slides PDF has one page per slide ($pages)"; else fail "slides PDF has $pages pages for $slides slides"; fi
    if grep -aqE '/MediaBox ?\[ ?0 0 960 540 ?\]' "$SLIDES_PDF"; then ok "slides PDF pages are 16:9"; else fail "slides PDF pages aren't 16:9"; fi
  else
    fail "slides PDF missing or not a PDF"
  fi
else
  fail "mdo slides failed (see $OUT/slides.log)"; tail -5 "$OUT/slides.log"
fi

if [ "$OPEN" = "--open" ]; then
  opener=$(command -v open || command -v xdg-open)
  "$opener" "$OUT/README.pdf"
  "$opener" "$HTML"
  "$opener" "$SLIDES_PDF"
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "All checks passed."
else
  echo "$failures check(s) failed."
  exit 1
fi

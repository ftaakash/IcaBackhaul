#!/bin/bash
# Build the story as one self-contained HTML page: dist/fifteen-links-over-ica.html
# Parcel bundles the React app, html-inline inlines JS/CSS, then the page is reshaped
# so <title> comes first and Google Fonts load from their CDN (the only external request).
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf .build bundle.html
pnpm exec parcel build index.html --dist-dir .build --no-source-maps --no-cache
pnpm exec html-inline .build/index.html > bundle.html

python3 - <<'PY'
import pathlib, re
s = pathlib.Path("bundle.html").read_text()
fonts = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@500;700;800'
         '&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">')
title = re.search(r"<title>.*?</title>", s, re.S).group(0)
style = re.search(r"<style>.*?</style>", s, re.S).group(0)
script = re.search(r"<script[^>]*>.*</script>", s, re.S).group(0)
out = pathlib.Path("dist/fifteen-links-over-ica.html")
out.parent.mkdir(exist_ok=True)
out.write_text(f'{title}\n{fonts}\n{style}\n<div id="root"></div>\n{script}\n')
print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
PY
rm -rf .build bundle.html

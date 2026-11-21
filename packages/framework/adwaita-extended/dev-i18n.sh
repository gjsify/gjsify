#!/usr/bin/env bash
# Refresh po/gjsify-adwaita-extended.pot from src and merge it into every po/*.po.
# `.blp` files (Blueprint, strings as _("…")) are extracted too; `app/dev/check-i18n.mjs` checks this domain.
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN='gjsify-adwaita-extended'
POT="po/$DOMAIN.pot"
{ find src -type f -name '*.ts' ! -name '*.story.ts'; find src -type f -name '*.blp'; } | LC_ALL=C sort > po/POTFILES.in
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
grep -v '\.blp$' po/POTFILES.in > "$tmp/js" || true
grep '\.blp$' po/POTFILES.in > "$tmp/blp" || true
xgettext --files-from="$tmp/js" --output="$POT" --from-code=UTF-8 \
    --language=JavaScript --keyword=_ --keyword=_n:1,2 --add-comments=TRANSLATORS \
    --package-name="$DOMAIN" --msgid-bugs-address='https://github.com/gjsify/gjsify/issues'
if [ -s "$tmp/blp" ]; then
    xgettext --files-from="$tmp/blp" --output="$POT" --join-existing --from-code=UTF-8 \
        --language=C --keyword=_ --keyword=C_:1c,2 --add-comments=TRANSLATORS \
        --package-name="$DOMAIN" --msgid-bugs-address='https://github.com/gjsify/gjsify/issues'
fi
while read -r lang; do
    [ -n "$lang" ] || continue
    if [ -f "po/$lang.po" ]; then msgmerge --update --previous --backup=none "po/$lang.po" "$POT"
    else msginit --no-translator --locale="$lang" --input="$POT" --output-file="po/$lang.po"; fi
done < po/LINGUAS

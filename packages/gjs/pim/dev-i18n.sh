#!/usr/bin/env bash
# Refresh po/gjsify-pim.pot from src and merge it into every po/*.po.
#
# This package binds no text domain: it runs on Node too, where GJS's `gettext` does not exist.
# The app registers its translator with `setPimTranslator`, so these msgids must end up in the
# APP's catalogue. The package ships both files for that: an app merges `po/gjsify-pim.pot` into
# its template and `po/<lang>.po` into its catalogue (`msgcat --use-first`), and does not
# translate these strings itself.
#
#   ./dev-i18n.sh          refresh the template and the catalogues
#   ./dev-i18n.sh --check  fail when the template is stale or a catalogue is incomplete
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN='gjsify-pim'
POT="po/$DOMAIN.pot"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
find src -type f -name '*.ts' ! -name '*.spec.ts' ! -name 'test*.ts' ! -name 'fake-dav-server.ts' \
    | LC_ALL=C sort > po/POTFILES.in
extract() {
    xgettext --files-from=po/POTFILES.in --output="$1" --from-code=UTF-8 --no-git \
        --language=JavaScript --keyword=_ --keyword=_n:1,2 --add-comments=TRANSLATORS \
        --package-name="$DOMAIN" --msgid-bugs-address='https://github.com/gjsify/gjsify/issues'
}
if [ "${1:-}" = --check ]; then
    extract "$tmp/fresh.pot"
    msgids() { msgcat --no-location --no-wrap --sort-output "$1" | grep -E '^msgid(_plural)? ' | grep -vx 'msgid ""' ; }
    if ! diff <(msgids "$tmp/fresh.pot") <(msgids "$POT") >/dev/null; then
        echo "$POT is stale: run ./dev-i18n.sh" >&2; exit 1
    fi
    while read -r lang; do
        [ -n "$lang" ] || continue
        msgfmt --check --output-file=/dev/null "po/$lang.po"
        stats="$(msgfmt --statistics --output-file=/dev/null "po/$lang.po" 2>&1)"
        case "$stats" in *fuzzy*|*untranslated*) echo "po/$lang.po: $stats" >&2; exit 1 ;; esac
        if ! diff <(msgids "$POT") <(msgids "po/$lang.po") >/dev/null; then
            echo "po/$lang.po does not match $POT: run ./dev-i18n.sh" >&2; exit 1
        fi
    done < po/LINGUAS
    echo "$DOMAIN: catalogue complete"
    exit 0
fi
extract "$POT"
while read -r lang; do
    [ -n "$lang" ] || continue
    if [ -f "po/$lang.po" ]; then msgmerge --quiet --update --previous --backup=none "po/$lang.po" "$POT"
    else msginit --no-translator --locale="$lang" --input="$POT" --output-file="po/$lang.po"; fi
done < po/LINGUAS
printf '%s: %s msgids\n' "$DOMAIN" "$(grep -c '^msgid "' "$POT")"

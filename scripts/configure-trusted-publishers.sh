#!/usr/bin/env bash
# Configure npm Trusted Publishers (OIDC / GitHub Actions) for every
# publishable @gjsify/* workspace package, so `.github/workflows/release.yml`
# can publish via OIDC token exchange — no long-lived NPM_TOKEN.
#
# WHY A SCRIPT: npm Trusted Publishing is configured PER PACKAGE (there is no
# org/scope-level config) and the only programmatic path is `npm trust`
# (npm CLI >= 11.10.0). This loops it over all ~110 packages.
#
# The config written per package MUST match the OIDC JWT that release.yml
# presents (verified via `gjsify foreach publish --check-trusted`):
#   provider   = GitHub Actions
#   repository = gjsify/gjsify
#   workflow   = release.yml        (filename only — npm maps it to the path)
#   environment= (none)             (the release.yml job declares none)
#   action     = publish            (required since npm's 2026-05-20 change)
#
# PREREQS:
#   1. npm >= 11.10.0                  (check: npm --version)
#   2. Authenticated:  npm login      (~/.npmrc token must be valid — a dead
#                                       token shows `{}` from `npm whoami`)
#   3. 2FA skip window: on the FIRST `npm trust` call npmjs.com offers
#      "skip 2FA for the next 5 minutes" — accept it. ~80 packages fit per
#      window, so for >80 packages you re-confirm once. The script is
#      idempotent — just re-run it to finish any that a lapsed window skipped.
#
# USAGE:
#   bash scripts/configure-trusted-publishers.sh            # configure all
#   bash scripts/configure-trusted-publishers.sh --dry-run  # list packages only
set -uo pipefail

REPO="gjsify/gjsify"
WORKFLOW="release.yml"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

cd "$(dirname "$0")/.." || exit 1

# Enumerate publishable @gjsify/* packages (has a name, private !== true).
mapfile -t PKGS < <(node -e '
const fs=require("fs"),path=require("path");const out=[];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  if(["node_modules",".git","refs"].includes(e.name))continue;
  const p=path.join(d,e.name);
  if(e.isDirectory())walk(p);
  else if(e.name==="package.json"){try{const j=JSON.parse(fs.readFileSync(p,"utf8"));
    if(j.name&&j.name.startsWith("@gjsify/")&&j.private!==true)out.push(j.name);}catch{}}
}})(".");
console.log([...new Set(out)].sort().join("\n"));
')

echo "Found ${#PKGS[@]} publishable @gjsify/* packages."
echo "Config: provider=github repo=$REPO workflow=$WORKFLOW env=(none) action=publish"
echo

if [ "$DRY_RUN" = 1 ]; then
  printf '  %s\n' "${PKGS[@]}"
  echo
  echo "(dry-run — nothing changed)"
  exit 0
fi

WHO=$(npm whoami 2>/dev/null) || { echo "ERROR: not authenticated. Run 'npm login' first."; exit 1; }
echo "Authenticated as: $WHO"
echo "Starting — accept the npmjs.com '2FA skip (5 min)' prompt on the first call."
echo

ok=0; fail=0; failed=()
for pkg in "${PKGS[@]}"; do
  printf '→ %-45s ' "$pkg"
  if npm trust github "$pkg" --file "$WORKFLOW" --repository "$REPO" --allow-publish --yes; then
    ok=$((ok+1))
  else
    fail=$((fail+1)); failed+=("$pkg")
  fi
  sleep 2
done

echo
echo "Done: $ok configured, $fail failed."
if [ "$fail" -gt 0 ]; then
  echo "Failed (re-run this script — it's idempotent; usually a lapsed 2FA window or rate-limit):"
  printf '  %s\n' "${failed[@]}"
  exit 1
fi
echo "Next: verify with  gh workflow run release.yml --ref main -f verify_only=true"

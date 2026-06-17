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
#      "skip 2FA for the next 5 minutes" — accept it. The script is idempotent
#      AND incremental: it first queries `npm trust list <pkg>` (read-only, no
#      2FA) and SKIPS any package already configured for this repo+workflow, so
#      a re-run only spends the 2FA window on the packages still missing it.
#      Packages not yet on npm are reported separately (they need a first
#      publish before they can be trust-configured).
#
# USAGE:
#   bash scripts/configure-trusted-publishers.sh            # configure missing only
#   bash scripts/configure-trusted-publishers.sh --dry-run  # list packages only
#   FORCE=1 bash scripts/configure-trusted-publishers.sh    # re-apply to ALL (no skip)
set -uo pipefail

REPO="gjsify/gjsify"
WORKFLOW="release.yml"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

cd "$(dirname "$0")/.." || exit 1

# Enumerate publishable @gjsify/* packages (has a name, private !== true).
# Skip node_modules / refs / VCS AND build-output dirs (platforms/, hooks/,
# dist/, .ns-vite-build/, any dotted dir) — those hold GENERATED package.json
# files (e.g. a NativeScript test app's build artifacts carry the app name but
# no `private` field, which would otherwise leak a private package into the list).
mapfile -t PKGS < <(node -e '
const fs=require("fs"),path=require("path");const out=[];
const SKIP=new Set(["node_modules",".git","refs","platforms","hooks","dist","build","lib"]);
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  if(SKIP.has(e.name)||e.name.startsWith("."))continue;
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

# npm's registry (since 2026-05-20) REQUIRES an allowed action on a trusted
# publisher, sent via `--allow-publish`. That flag landed after npm 11.12.1,
# so fall back to `npx -y npm@latest` when the local npm is too old.
if npm trust github --help 2>&1 | grep -q -- '--allow-publish'; then
  NPM_TRUST="npm trust"
else
  echo "Local npm ($(npm --version)) lacks 'trust --allow-publish' → using 'npx -y npm@latest'."
  NPM_TRUST="npx -y npm@latest trust"
fi
FORCE="${FORCE:-0}"
if [ "$FORCE" = 1 ]; then
  echo "FORCE=1 — re-applying to every package (no skip of already-configured)."
else
  echo "Incremental — already-configured packages are skipped (set FORCE=1 to re-apply all)."
fi
# Pre-warm npx so the FIRST `npm trust list` isn't garbled by the one-time
# `npm@latest` download (that made the first package fall through the
# already-trusted check and hit a needless 409).
case "$NPM_TRUST" in
  npx*) printf 'Pre-warming npx (downloads npm@latest once)… '
        npx -y npm@latest --version >/dev/null 2>&1 && echo ok || echo '(warning: pre-warm failed)';;
esac
echo "Starting — accept the npmjs.com '2FA skip (5 min)' prompt on the first call."
echo

# Classify a package via a read-only `npm trust list`:
#   trusted     — already has an entry for THIS repo+workflow → skip
#   unpublished — not on npm yet (404) → needs a first publish before trust
#   untrusted   — published, no matching entry → configure it
#   unknown     — auth required (EOTP, the 2FA-skip window lapsed) → can't tell
# NOTE: `npm trust list` is auth'd — it works only WITHIN the 5-min 2FA-skip
# window (i.e. after the first interactive auth). Before that / once it lapses
# it returns EOTP. So this pre-check is a best-effort optimisation; the
# authoritative idempotency signal is the 409 from the configure step below,
# which is window-independent.
trust_state() {
  local out
  out=$($NPM_TRUST list "$1" 2>&1)
  if grep -q "repository: $REPO" <<<"$out" && grep -q "file: $WORKFLOW" <<<"$out"; then
    echo trusted
  elif grep -qE '\b404\b|E404' <<<"$out"; then
    echo unpublished
  elif grep -qE 'EOTP|one-time password' <<<"$out"; then
    echo unknown
  else
    echo untrusted
  fi
}

tmp_out=$(mktemp)
trap 'rm -f "$tmp_out"' EXIT

ok=0; fail=0; skipped=0; unpublished=0; failed=(); needs_publish=()
for pkg in "${PKGS[@]}"; do
  printf '→ %-45s ' "$pkg"
  state=$(trust_state "$pkg")
  if [ "$FORCE" != 1 ] && [ "$state" = trusted ]; then
    echo "already configured — skip"
    skipped=$((skipped+1))
    continue
  fi
  if [ "$state" = unpublished ]; then
    echo "not on npm yet — needs first-publish, skip"
    unpublished=$((unpublished+1)); needs_publish+=("$pkg")
    continue
  fi
  echo
  # `tee` keeps the interactive 2FA prompt visible while capturing the output
  # so we can read npm's exit code (PIPESTATUS) and spot a 409 Conflict — which
  # means the exact config already exists (idempotent, not a failure), and is
  # reliable even when the 2FA-skip window has lapsed.
  $NPM_TRUST github "$pkg" --file "$WORKFLOW" --repository "$REPO" --allow-publish --yes 2>&1 | tee "$tmp_out"
  rc=${PIPESTATUS[0]}
  if [ "$rc" -eq 0 ]; then
    ok=$((ok+1))
  elif grep -qE '\b409\b|Conflict' "$tmp_out"; then
    echo "  → already configured (409) — counted as done"
    skipped=$((skipped+1))
  else
    fail=$((fail+1)); failed+=("$pkg")
  fi
  sleep 2
done

echo
echo "Done: $ok configured, $skipped already-configured, $unpublished unpublished, $fail failed."
if [ "$unpublished" -gt 0 ]; then
  echo "Need a first publish before they can be trust-configured (then re-run this script):"
  printf '  %s\n' "${needs_publish[@]}"
fi
if [ "$fail" -gt 0 ]; then
  echo "Failed (re-run this script — it's incremental; usually a lapsed 2FA window or rate-limit):"
  printf '  %s\n' "${failed[@]}"
  exit 1
fi
echo "Next: verify with  gh workflow run release.yml --ref main -f verify_only=true"

#!/usr/bin/env bash
# Second pass of a publish sweep: publish the packages the sweep HELD.
#
# A package is held when a required intra-repo pin is not yet served by the registry
# (npm "validating"). The sweep is one process per package and waits only --hold-timeout, so
# a slow dependency leaves its dependents held and the sweep exits 0 (next run 39674539772:
# cli@next stayed missing behind a green job). This pass waits for those blockers, bounded by
# GJSIFY_HOLD_DEADLINE, and publishes the held names topologically.
#
# Usage: retry-held-publish.sh <dist-tag>
# Env:   GJSIFY_PUBLISH_LEDGER  required (the ledger the sweep wrote)
#        HELD_PASS_SECONDS      total wait budget for the pass, default 300
# Flags mirror package.json `npm:publish:prebuilt` / `npm:publish:next`; keep them in sync.
set -euo pipefail

tag="${1:?usage: retry-held-publish.sh <dist-tag>}"
: "${GJSIFY_PUBLISH_LEDGER:?GJSIFY_PUBLISH_LEDGER must name the sweep ledger}"

mapfile -t held < <(gjsify publish --held-names)
if [ "${#held[@]}" -eq 0 ]; then
  echo "retry-held-publish: nothing held"
  exit 0
fi
echo "retry-held-publish: second pass for ${#held[@]} held package(s): ${held[*]}"

GJSIFY_HOLD_DEADLINE=$(( $(date +%s) * 1000 + ${HELD_PASS_SECONDS:-300} * 1000 ))
export GJSIFY_HOLD_DEADLINE

inc=()
for name in "${held[@]}"; do inc+=(--include "$name"); done
gjsify foreach -v --topological --no-private --exclude "@girs/*" "${inc[@]}" --exec -- \
  gjsify publish --tolerate-republish --tolerate-untrusted-new --verify-defer \
  --verify-timeout 5 --tag "$tag" --access public

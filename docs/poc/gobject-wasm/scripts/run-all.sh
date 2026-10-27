#!/bin/bash
# SPDX-License-Identifier: MIT
# Build everything from nothing, then run the milestones under Node.
#
#   docs/poc/gobject-wasm/scripts/run-all.sh
#
# ~45 min cold on a 16-core box, ~2 GB under $POC_ROOT (default ~/.cache/gjsify-wasm).
# Each step is skip-if-present, so re-running after a failure resumes.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for step in 00-emsdk 10-libffi 20-glib 30-emnapi 35-typelibs 40-node-gi; do
    poc_log "step $step"
    bash "$HERE/$step.sh"
done

poc_log "milestones (node)"
cd "$POC_REPO"
NODE_GI_WASM_DIR="$POC_OUT" node --conditions=wasm "$POC_DIR/harness/run-node.mjs"

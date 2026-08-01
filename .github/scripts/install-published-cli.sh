#!/bin/sh
# Install a published @gjsify/cli into the CURRENT directory (an npm prefix the
# caller has already created), preferring the version this checkout declares.
#
#   Usage: .github/scripts/install-published-cli.sh <declared-version>
#
# WHY THIS IS NOT THE ONE-LINER IT REPLACES. `release.yml` publishes the ~130
# workspace packages SERIALLY, so for several minutes after a release commit
# lands npm holds an INCOMPLETE set of the new version. Two distinct failures
# live in that window and the previous guard only covered the first:
#
#   1. the declared version is not on npm yet    → `@gjsify/cli@<v>` 404s
#   2. it IS on npm but its DEPENDENCIES are not → `@gjsify/cli@latest` resolves
#      to that same new version and the install dies on a transitive
#      `ETARGET No matching version found for @gjsify/<pkg>@^<v>`
#
# Falling back to `@latest` fixes (1) and walks straight into (2). Measured
# 2026-08-01: a job at 13:13 died on `@gjsify/buffer@^0.26.1`, a retry two
# minutes later died on `@gjsify/web-polyfills@^0.26.1`, and the train only
# finished at 13:22 — after which the identical command succeeded.
#
# The condition is transient and SELF-RESOLVING, so the right response is to
# wait, not to fail. A recurring red that fixes itself is worse than a slow job:
# it teaches everyone to re-run without reading, which is how a real failure
# eventually gets waved through. That is the reasoning the old comment already
# carried — this only makes the code match it.
set -e

CLI_VERSION="$1"
[ -n "$CLI_VERSION" ] || { echo "::error::install-published-cli.sh needs the declared version"; exit 2; }

ATTEMPTS=${CLI_INSTALL_ATTEMPTS:-6}
DELAY=${CLI_INSTALL_DELAY:-30}

i=1
while :; do
    # The declared version first: it is what this checkout was built against, so
    # anything else is a compromise and gets reported as one.
    if npm install "@gjsify/cli@${CLI_VERSION}" --no-audit --no-fund --no-save 2>/dev/null; then
        echo "Using @gjsify/cli@${CLI_VERSION} (the version this checkout declares)."
        exit 0
    fi
    if npm install "@gjsify/cli@latest" --no-audit --no-fund --no-save 2>/dev/null; then
        echo "::warning::@gjsify/cli@${CLI_VERSION} is not fully on npm — using @latest instead."
        exit 0
    fi
    if [ "$i" -ge "$ATTEMPTS" ]; then
        echo "::error::No complete @gjsify/cli on npm after ${ATTEMPTS} attempts —"
        echo "::error::neither @${CLI_VERSION} nor @latest resolved with a full dependency set."
        echo "::error::During a release this is the publish window and self-resolves; otherwise"
        echo "::error::the published set is genuinely broken. Re-running for the real npm error:"
        npm install "@gjsify/cli@${CLI_VERSION}" --no-audit --no-fund --no-save || true
        exit 1
    fi
    echo "npm has no complete @gjsify/cli yet (attempt ${i}/${ATTEMPTS}) — a release is probably" \
        "mid-publish. Retrying in ${DELAY}s."
    sleep "$DELAY"
    i=$((i + 1))
done

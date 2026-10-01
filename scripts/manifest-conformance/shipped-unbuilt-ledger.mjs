/**
 * The SHIPPED-UNBUILT ledger — packages a shipped scope may not answer for, each with a
 * reason and an issue.
 *
 * WHY A LEDGER AND NOT A FLAG. `--scope=ship` turns "this package's shipped root entry is
 * not on disk" into a failure, which is the anti-vacuity property #1898 needs: a gate that
 * reports success for a population it never opened is the defect. Some packages genuinely
 * cannot be answered for on a given runner, and the two available answers are both bad —
 * failing on them trains people to pass `--allow-unbuilt` everywhere (which restores the
 * vacuity for everything), and dropping the check for them restores it for them. So the
 * exception is a NAMED entry carrying a reason and an issue, printed on every run, and it
 * RETIRES ITSELF.
 *
 * The self-retiring part is the point and it is borrowed from
 * `status/stylesheet-font-families.json` for the same reason. An entry that no longer
 * describes a live gap FAILS, so a package that starts building cannot leave a standing
 * excuse behind — the ledger cannot become where omissions go to die, which is how
 * `scripts/e2e-unlisted-suites.mjs` and the retired `PREBUILD_GIR_GAPS` both had to be
 * written twice.
 *
 * NOT AN ALLOWLIST OF VIOLATIONS. An entry here excuses a package for being UNREAD, which
 * is an infrastructure fact. A package whose shipped bundle breaks a promise it made is
 * still a failure with no entry to buy it out; that is `shipped-gi-deps` and it has no
 * ledger, deliberately.
 *
 * Repo-shaped (it names this repository's packages and its workflows), so it lives in
 * `scripts/` and is handed to the portable rule through `ctx.options` — the rule applies
 * the list and knows no package name.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LEDGER_PATH = 'scripts/manifest-conformance/shipped-unbuilt-allowlist.json';

/**
 * @param {string} repoRoot the REPOSITORY the ledger describes — NOT the tree being
 *   audited. `--root` points the context at another workspace, and the ledger names
 *   packages of THIS repository with reasons that name this repository's workflows, so
 *   resolving it against the audited tree made every `--root` run report it malformed and
 *   exit 2. Repo knowledge resolves against the repo; the audited root is the subject.
 * @returns {{entries: Map<string, {reason: string, issue: string}>, missing: string[]}}
 */
export function readShippedUnbuiltLedger(repoRoot) {
    let raw;
    try {
        raw = JSON.parse(readFileSync(join(repoRoot, LEDGER_PATH), 'utf8'));
    } catch {
        return { entries: new Map(), missing: [LEDGER_PATH] };
    }
    const entries = new Map();
    const missing = [];
    for (const entry of raw.entries ?? []) {
        if (typeof entry?.package !== 'string' || typeof entry?.reason !== 'string' || entry.reason.length === 0) {
            missing.push(
                `${LEDGER_PATH}: entry ${JSON.stringify(entry)} needs a \`package\` and a non-empty \`reason\``,
            );
            continue;
        }
        if (typeof entry.issue !== 'string' || entry.issue.length === 0) {
            missing.push(`${LEDGER_PATH}: "${entry.package}" has no \`issue\` — an unexplained exception is a hole`);
            continue;
        }
        entries.set(entry.package, { reason: entry.reason, issue: entry.issue });
    }
    return { entries, missing };
}

/** Printed on every run so a standing exception stays visible rather than merely recorded. */
export function renderUnbuiltAllowlist(entries) {
    if (entries.size === 0) return [];
    return [
        `${entries.size} package(s) excused from a shipped scope by ${LEDGER_PATH} — each is one this runner ` +
            'cannot build, and each is listed with a reason and an issue:',
        ...[...entries].map(([name, { reason, issue }]) => `  · ${name} — ${reason} (${issue})`),
    ];
}

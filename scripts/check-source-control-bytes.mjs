#!/usr/bin/env node
// A tracked text file must not contain a raw NUL byte.
//
// THE INVARIANT
//
// NUL is the one byte that is never text. Inside a string literal it is a value
// nobody can see; outside one it is a syntax error waiting for a different
// parser. And it changes how the FILE is classified: git treats a file
// containing NUL as binary, so `git diff` stops showing content and reports
// "Bin 11257 -> 11318 bytes" instead. When a NUL genuinely belongs in a string,
// JavaScript already spells it `\0` — four ASCII characters that survive a
// copy-paste, a diff, a review and a formatter, which the raw byte does not.
//
// THE INCIDENT
//
// A `join(' ')` in `scripts/manifest-conformance/rules/pr-trigger-parity.mjs`
// was written as `join('\0')` — the separator was a NUL rather than a space.
// Everything passed: `tsc`, `oxlint`, that rule's own 13-case e2e (a join is
// deterministic whichever separator it uses, so the comparison still agreed),
// and `audit-runtimes --check`. `oxfmt --check` did fail on the file, but on
// indentation, and reformatting PRESERVED the NUL. The only symptom anywhere
// was git calling a hand-written `.mjs` binary, which reads as noise unless you
// know it cannot be.
//
// A sweep then found one more, older and deliberate:
// `packages/node/http/src/index.browser.spec.ts` asserted that a header value
// containing NUL is rejected and embedded the byte, two lines below a sibling
// assertion that correctly writes `\r` as an escape. It worked, and it made
// that spec binary to git too.
//
// WHAT THIS DELIBERATELY DOES NOT CHECK
//
// Other C0 controls. The first draft of this script flagged every byte under
// 0x20, and measured 37 findings across the tree: two in the committed
// `affected.gjs.mjs` bundle, one NUL, and 34 raw ESC bytes in ANSI-colour test
// fixtures (`tests/integration/{chalk,debug}`, `packages/node/util`'s inspect
// specs). Those ESCs are the subject of the assertions around them and are not
// a defect. A check that fires 34 times on correct code trains people to route
// around it, so the scope is the byte with a measured incident and no
// legitimate raw use in this tree.
//
// Escapes are unaffected: this reads BYTES, so `'\0'` in source is
// backslash-zero, two ASCII characters. Only the literal byte is a finding.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Text extensions only. `git ls-files` also lists PNGs, prebuilt `.so`s and the
 * committed `.typelib`s, which are binary BY DESIGN — scanning them would make
 * this an exception list instead of a rule. `.mjs` stays in even though one
 * committed bundle lives there: a NUL reaching a bundle is its own known defect
 * (an escaped NUL in source emitted as a raw byte by the minifier), and this is
 * a place it would be seen.
 */
const TEXT_EXT =
    /\.(?:ts|mts|cts|js|mjs|cjs|jsx|tsx|json|jsonc|md|ya?ml|sh|bash|zsh|toml|css|scss|html|xml|blp|ui|vala|vapi|rs|py|txt|cfg|conf|in|gir)$/;

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter((file) => file && TEXT_EXT.test(file));

const findings = [];
let scanned = 0;
for (const file of tracked) {
    let bytes;
    try {
        bytes = readFileSync(join(ROOT, file));
    } catch {
        // A tracked path that is not readable here (a submodule gitlink, a file
        // deleted in the working tree) is not this check's subject. Skipping is
        // safe BECAUSE an unopenable path holds no bytes to judge — unlike a
        // check that skips the thing it was pointed at.
        continue;
    }
    scanned += 1;
    let at = bytes.indexOf(0);
    while (at !== -1) {
        const before = bytes.subarray(0, at);
        findings.push({
            file,
            line: before.filter((byte) => byte === 0x0a).length + 1,
            column: at - before.lastIndexOf(0x0a),
        });
        at = bytes.indexOf(0, at + 1);
    }
}

if (findings.length === 0) {
    console.log(`[check-source-control-bytes] ok — ${scanned} tracked text file(s), no raw NUL byte.`);
    process.exit(0);
}

console.error(`[check-source-control-bytes] ${findings.length} raw NUL byte(s) in tracked text files:\n`);
for (const { file, line, column } of findings) {
    console.error(`  ${file}:${line}:${column}`);
}
console.error(
    '\nWrite it as the escape `\\0`. A raw NUL passes tsc, oxlint, oxfmt and the conformance audit, and makes ' +
        'git classify the file as binary so the diff stops showing content — see the header of this script for ' +
        'the two measured instances.',
);
process.exit(1);

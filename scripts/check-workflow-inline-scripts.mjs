#!/usr/bin/env node
// Refuse a workflow whose inline `node -e` / `python3 -c` body contains its own
// shell quote character.
//
// THE INCIDENT
//
// `release.yml`'s two GTK-runtime verify steps each ended with
//
//     … data sets ${verified.map((v) => v.id).join('+')}`);
//
// inside a SINGLE-QUOTED `node -e '…'`. The shell closes the string at the quote
// before `+`; node received `join(+)` and died with `SyntaxError: Unexpected token
// ')'` before evaluating one assertion. All three v0.28.0 bundle publish legs failed
// there while every bundle they gated was correct, so `@gjsify/cli`/`node-gi`/`napi`
// went out at 0.28.0 and the three `@gjsify/gtk-runtime-*` packages stayed at 0.27.1
// — the exact version whose defects that gate had just been written to prevent.
//
// It survived review twice (once per shell) because the quote is visually inert: the
// JS reads correctly, and only the shell layer between the YAML and node disagrees.
// And nothing ran it before the release — `release.yml` triggers on `release` /
// `workflow_dispatch` only, so no PR ever executed either block.
//
// This is the same class as `assertShellSafeWorkspaceName` in the affected-classifier
// transport, and it was settled there in the same terms: pre-quoting for unknown
// nesting cannot work, emitting text that needs no quoting can. The primary fix is
// therefore to move the body into a script file (`packages/node-gi/scripts/
// verify-bundle-manifest.mjs`); this check is what stops the shape from regrowing.
//
// WHAT IT CHECKS — deliberately only the MULTI-LINE form
//
// For every `node -e|-p|--eval|--print <q>` / `python3 -c <q>` with q ∈ {', "} whose
// body opens at END OF LINE, no line of the body may contain q. In a q-delimited
// shell string an unescaped q cannot be body text — it IS the close — so any
// occurrence is the defect, with no judgement call.
//
// Single-line invocations are deliberately NOT checked. There, q legitimately recurs
// as part of an enclosing construct — `echo "… $(node -p "require('./p.json').v")"`
// is correct and a counting rule flags it. A first draft of this check did exactly
// that: 23 findings, 21 of them false, including the correct
// `cli-cross-platform.yml:193` block. A check with false positives gets disabled, and
// then it protects nothing.
//
// The body's end is the first line whose trimmed text STARTS WITH q — not one equal
// to q. `release.yml` closed on a bare `'`, `cli-cross-platform.yml` on `')"`; the
// stricter equality read past the real end and flagged every apostrophe in the
// comments below it.
//
// It does NOT parse YAML or lex the shell. It does not need to: the defect is
// lexical, one quote character in the wrong place.
//
// Usage: node scripts/check-workflow-inline-scripts.mjs [--root <dir>]
// Exits 1 and names file:line + the offending text on any finding.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex === -1 ? process.cwd() : args[rootIndex + 1];
const workflowDir = join(root, '.github', 'workflows');

// `node -e '`, `node --eval "`, `python3 -c '`, … — capture the quote that opens the body.
const OPENER = /\b(node|python3?)\s+(?:-e|-p|--eval|--print|-c)\s+(['"])/g;

/**
 * Remove the spellings that legitimately place a quote inside a quoted body: the two
 * splice idioms, and a backslash escape (valid inside a double-quoted shell string,
 * never inside a single-quoted one — where a backslash is literal, so `\'` still ends
 * the string and must stay counted).
 */
function stripSplices(text, quote) {
    let out = text.replaceAll(`'\\''`, '').replaceAll(`'"'"'`, '');
    if (quote === '"') out = out.replaceAll('\\"', '');
    return out;
}

function countQuote(text, quote) {
    return stripSplices(text, quote).split(quote).length - 1;
}

const findings = [];

function checkFile(path) {
    const lines = readFileSync(path, 'utf8').split('\n');
    const rel = relative(root, path);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        OPENER.lastIndex = 0;
        let match;
        while ((match = OPENER.exec(line)) !== null) {
            const quote = match[2];
            const rest = line.slice(match.index + match[0].length);

            // Single-line form is out of scope — see the header. Only a body that
            // opens at end of line is judged.
            if (rest.trim() !== '') continue;

            // The close is the first line whose trimmed text STARTS WITH the quote:
            // a bare `'` in release.yml, `')"` where the body feeds a substitution.
            let close = -1;
            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].trim().startsWith(quote)) {
                    close = j;
                    break;
                }
            }
            if (close === -1) {
                findings.push({
                    file: rel,
                    line: i + 1,
                    detail: `inline ${match[1]} body opens with ${quote} at end of line and no line closing it was found`,
                    text: line.trim(),
                });
                continue;
            }
            for (let j = i + 1; j < close; j++) {
                const count = countQuote(lines[j], quote);
                if (count > 0) {
                    findings.push({
                        file: rel,
                        line: j + 1,
                        detail: `inline ${match[1]} body (opened ${rel}:${i + 1}) contains ${quote} — the shell closes the string here`,
                        text: lines[j].trim(),
                    });
                }
            }
        }
    }
}

let files;
try {
    files = readdirSync(workflowDir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
} catch (error) {
    console.error(`check-workflow-inline-scripts: cannot read ${workflowDir}: ${error.message}`);
    process.exit(1);
}

for (const name of files.sort()) checkFile(join(workflowDir, name));

if (findings.length) {
    console.error(`check-workflow-inline-scripts: ${findings.length} broken inline script body/bodies\n`);
    for (const finding of findings) {
        console.error(`  ${finding.file}:${finding.line} — ${finding.detail}`);
        console.error(`    ${finding.text.length > 140 ? `${finding.text.slice(0, 140)}…` : finding.text}\n`);
    }
    console.error(
        'Fix by moving the body into a script file (no shell-quoting layer, one copy, testable),\n' +
            'which is what packages/node-gi/scripts/verify-bundle-manifest.mjs is. Swapping the outer\n' +
            'quote only relocates the trap to the next character of the other kind.',
    );
    process.exit(1);
}

console.log(`check-workflow-inline-scripts: ${files.length} workflow(s) clean.`);

#!/usr/bin/env node
// A keyboard affordance adwaita-web DECLARES has an implementation behind it.
//
// THE INCIDENT, in one line each — the modules hold them in full, and a third copy here
// is what drifts: `elements/modal-surface.ts` for the trap, `elements/roving-focus.ts`
// for the roving tabindex. `aria-modal="true"` was set on four dialog surfaces and
// honoured by ONE, a real Tab walking out of the other three onto a control behind their
// own scrim; a roving `tabIndex = -1` was set on four composites with no keydown listener
// anywhere, leaving every unselected item reachable by NO key. Both were GREEN in a suite
// of 4321 assertions, because every one of them read state.
//
// ONE SCRIPT, THREE ARMS, deliberately. They are the same invariant at three spellings,
// and the alternative is three more steps in BOTH copies of the required job for a rule
// that reads the same file set. Each arm names itself in its own failure.
//
// TRAP — `aria-modal` is declared EXACTLY ONCE in the package, in
// `elements/modal-surface.ts`, which both registers a keydown listener and handles
// `'Tab'`. Declaration and trap are the same call, so a fifth modal surface cannot be
// added without one. BOTH SPELLINGS count: `setAttribute('aria-modal', …)` and the
// reflected `.ariaModal =` property, which is standard DOM and sets the same attribute —
// the arm read only the first, and a dialog spelled the second way passed clean.
// ZERO occurrences fails too: a declaration that vanished is either modality no longer
// announced or a spelling this reader cannot see, and both are the blindness it removes.
//
// ROVING — a file that gives a repeated child a NEGATIVE tabindex must have a keydown
// listener behind it. "Repeated child" is derived from the RECEIVER: `this.<x>` is one
// fixed node this element owns, anything else (`item`, `row.el`, `nodes.button`) is built
// per item in a loop. Both spellings again — `x.tabIndex = -1` and
// `x.setAttribute('tabindex', '-1')`. Three arms discharge the obligation, all DERIVED
// from the tree, and {@link ROVING_LEDGER} records WHICH one per file. A `KEYNAV-BY:`
// header marker in the `CORE-VIA:` style was considered and REJECTED: every delegation in
// the tree today is visible as an import edge or a tag, so the marker would be an escape
// hatch nothing needs, and an unused escape hatch is what a later reader reaches for
// instead of fixing the widget. Add one when a real case cannot be derived — with the
// case, here.
//
// SPECS — the two files this script points at as the "does it WORK" half must exist. A
// pointer at a file nobody holds is how `check-adwaita-modal-trap.mjs`, a script that was
// never written, ended up cited in the header of the module the whole invariant rests on.
//
// WHAT IT DOES NOT CLAIM. That the trap or the arrow keys WORK. That is
// `packages/web/adwaita-web/src/keyboard-operable.spec.ts` (every surface and every
// composite, asserting `document.activeElement` after each press) and
// `tests/browser/specs/adwaita-keyboard.spec.ts` (the same under REAL key presses, which
// is the only way to reproduce the escape). This holds that an implementation EXISTS —
// the half a browser suite cannot hold for a widget nobody remembered to write a spec for.
//
// Usage: node scripts/check-adwaita-keyboard-contract.mjs [--root <dir>]

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADWAITA_WEB_SRC, adwaitaWebElements, adwaitaWebSources, stripComments } from './adwaita-elements.mjs';
import { toPosixPath } from '../packages/infra/manifest-conformance/lib/index.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];

/** Repo-relative and forward-slash: this string is COMPARED, and win32 spells it `\`. */
const rel = (file) => toPosixPath(relative(ROOT, file));

/** The one file allowed to declare modality, as a repo-relative posix path. */
const TRAP_MODULE = `${ADWAITA_WEB_SRC}/elements/modal-surface.ts`;

/** The two suites this script's own header names as the "does it WORK" half. */
const CONTRACT_SPECS = [`${ADWAITA_WEB_SRC}/keyboard-operable.spec.ts`, 'tests/browser/specs/adwaita-keyboard.spec.ts'];

/**
 * Every file that hands a repeated child a negative tabindex → the arm that answers for
 * it. EXACT, both ways: a file entering roving scope and a file LEAVING it are equally a
 * commit to this ledger.
 *
 * A `> 0` floor was here first and could not see a PARTIAL shrink — respelling one
 * widget's assignment took the scope from 9 files to 8 and printed OK, which is the same
 * silent shrink the whole gate exists against. Pinning the arm as well as the file is
 * what makes arm (a) safe to keep: it is FILE-scoped, so any keydown listener in the file
 * discharges it, and a widget drifting from `via ./roving-focus.js` to a keydown listener
 * that has nothing to do with its items shows up here as a diff to be argued for.
 */
const ROVING_LEDGER = {
    'packages/web/adwaita-web/src/elements/adw-drop-down.ts': 'own keydown listener',
    'packages/web/adwaita-web/src/elements/adw-inline-view-switcher.ts': 'via ./roving-focus.js',
    'packages/web/adwaita-web/src/elements/adw-menu-button.ts': 'via <adw-popover>',
    'packages/web/adwaita-web/src/elements/adw-sidebar.ts': 'via ./roving-focus.js',
    'packages/web/adwaita-web/src/elements/adw-split-button.ts': 'via <adw-popover>',
    'packages/web/adwaita-web/src/elements/adw-tab-view.ts': 'own keydown listener',
    'packages/web/adwaita-web/src/elements/adw-toggle-group.ts': 'via ./roving-focus.js',
    'packages/web/adwaita-web/src/elements/adw-view-switcher-bar.ts': 'via ./roving-focus.js',
    'packages/web/adwaita-web/src/elements/adw-view-switcher.ts': 'via ./roving-focus.js',
    // Not a roving widget: `init.surface.tabIndex = -1` is the ONE box a dialog owns, and
    // a non-`this.` receiver is all this reader can see. It stays in scope rather than
    // being special-cased, because a receiver rule narrow enough to exclude it is narrow
    // enough to exclude a real widget that holds its items behind a local.
    'packages/web/adwaita-web/src/elements/modal-surface.ts': 'own keydown listener',
};

function fail(arm, lines) {
    console.error(`check-adwaita-keyboard-contract [${arm}]: ${lines.join('\n  ')}`);
    process.exit(1);
}

// Attribute AND reflected property: `Element.ariaModal` is standard DOM and sets the same
// attribute, so a reader of only the first was evaded by a one-word respelling.
const ARIA_MODAL = /setAttribute\(\s*['"`]aria-modal['"`]|\.ariaModal\s*=/g;
const KEYDOWN_LISTENER = /addEventListener\(\s*['"`]keydown['"`]/;
const RECEIVER = String.raw`([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)`;
const NEGATIVE_TABINDEX = [
    // `x.tabIndex = … -1 …` — the ternary `isActive ? 0 : -1` and the bare `-1` alike.
    new RegExp(String.raw`${RECEIVER}\.tabIndex\s*=\s*[^;\n]*-\s*1`, 'g'),
    // `x.setAttribute('tabindex', … '-1' …)` — the same act through the DOM API, and the
    // equally idiomatic spelling. Bounded by `;` rather than a newline: the argument list
    // of this call wraps across lines in the tree today.
    new RegExp(String.raw`${RECEIVER}\.setAttribute\(\s*['"\`]tabindex['"\`]\s*,[^;]*?-\s*1`, 'g'),
];
const CREATE_ADW_ELEMENT = /createElement\(\s*['"`](adw-[a-z0-9-]+)['"`]/g;

/** Value imports of a RELATIVE module: `{ a, b }` / `X` / `* as ns`, never `import type`. */
function relativeImports(code) {
    const found = [];
    for (const [, clause, spec] of code.matchAll(
        /(?:^|[\n;])\s*import\s+(?!type[\s{])([^'"]*?)\s*from\s*['"](\.[^'"]+)['"]/g,
    )) {
        const names = [];
        const named = /\{([^}]*)\}/.exec(clause);
        if (named) {
            for (const entry of named[1].split(',')) {
                const trimmed = entry.trim();
                if (trimmed === '' || /^type\s/.test(trimmed)) continue;
                names.push((trimmed.split(/\s+as\s+/).pop() ?? trimmed).trim());
            }
        }
        const bare = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
        if (bare) names.push(bare[1]);
        if (names.length > 0) found.push({ spec, names });
    }
    return found;
}

/** A TS source importing `./x.js` means `./x.ts` on disk. */
const sibling = (file, spec) => resolve(file, '..', spec.replace(/\.js$/, '.ts'));

const sources = adwaitaWebSources(ROOT);
if (sources.length === 0) {
    fail('scope', [
        `no .ts sources found under ${ADWAITA_WEB_SRC}. Either the package moved or the reader ` +
            'stopped matching — a scan with nothing in scope passes vacuously, so this is a failure.',
    ]);
}

/** file → comment-stripped source, so every scan below claims only what the module RUNS. */
const code = new Map(sources.map((file) => [file, stripComments(readFileSync(file, 'utf8'))]));

// ---------------------------------------------------------------------------
// TRAP
// ---------------------------------------------------------------------------

const declarers = [];
for (const [file, text] of code) {
    const count = (text.match(ARIA_MODAL) ?? []).length;
    if (count > 0) declarers.push({ file: rel(file), count });
}

const strays = declarers.filter((entry) => entry.file !== TRAP_MODULE);
if (strays.length > 0) {
    fail('trap', [
        `${strays.map((entry) => entry.file).join(', ')} set aria-modal directly.`,
        `    It belongs to ${TRAP_MODULE}, which sets it AND traps Tab in the same object —`,
        '    that is the whole point: three of four dialogs declared modality and let a real Tab',
        '    walk straight out of them, onto a control behind their own scrim.',
        '    Fix: `new AdwModalSurface({ host, surface, role, isOpen, onEscape })` — see `<adw-dialog>`.',
    ]);
}

const trap = declarers.find((entry) => entry.file === TRAP_MODULE);
if (trap === undefined) {
    fail('trap', [
        `${TRAP_MODULE} no longer sets aria-modal.`,
        '    Either modality is not announced at all any more, or it moved to a spelling this',
        '    reader cannot see. Both make every check below pass over anything — which is the',
        '    state this gate exists to make impossible.',
    ]);
}
if (trap.count !== 1) {
    fail('trap', [`${TRAP_MODULE} sets aria-modal ${trap.count} times; one surface, one declaration.`]);
}

const trapFile = sources.find((file) => rel(file) === TRAP_MODULE);
const trapCode = code.get(trapFile) ?? '';
if (!KEYDOWN_LISTENER.test(trapCode) || !/['"`]Tab['"`]/.test(trapCode)) {
    fail('trap', [
        `${TRAP_MODULE} declares aria-modal without registering a keydown listener that handles Tab.`,
        '    The single owner of the declaration is the single owner of the trap; if it stops',
        '    trapping, every dialog routed through it stops trapping at once and silently.',
    ]);
}

// ---------------------------------------------------------------------------
// ROVING
// ---------------------------------------------------------------------------

const definedIn = adwaitaWebElements(ROOT);
/** Does the file that defines <tag> register a keydown listener? */
const tagHandlesKeys = (tag) => {
    const defining = definedIn.get(tag);
    if (defining === undefined) return false;
    const absolute = sources.find((file) => rel(file) === toPosixPath(defining));
    return absolute !== undefined && KEYDOWN_LISTENER.test(code.get(absolute) ?? '');
};

/** file → the arm that answers for it, in the ledger's own wording. */
const roving = new Map();
const problems = [];

for (const [file, text] of code) {
    const receivers = NEGATIVE_TABINDEX.flatMap((pattern) => [...text.matchAll(pattern)])
        .map(([, receiver]) => receiver)
        // `this.…` is ONE node this element owns — a dialog box, a sheet. A repeated child
        // is held by a local: `item`, `row.el`, `nodes.button`.
        .filter((receiver) => receiver !== 'this' && !receiver.startsWith('this.'));
    if (receivers.length === 0) continue;

    // (a) the file registers a keydown listener itself.
    if (KEYDOWN_LISTENER.test(text)) {
        roving.set(rel(file), 'own keydown listener');
        continue;
    }

    // (b) calls an imported binding whose module registers one.
    const viaImport = relativeImports(text).find(
        ({ spec, names }) =>
            names.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(text)) &&
            KEYDOWN_LISTENER.test(code.get(sibling(file, spec)) ?? ''),
    );
    if (viaImport !== undefined) {
        roving.set(rel(file), `via ${viaImport.spec}`);
        continue;
    }

    // (c) creates an <adw-…> element whose defining file registers one.
    const viaTag = [...text.matchAll(CREATE_ADW_ELEMENT)].map(([, tag]) => tag).find(tagHandlesKeys);
    if (viaTag !== undefined) {
        roving.set(rel(file), `via <${viaTag}>`);
        continue;
    }

    roving.set(rel(file), null);
    problems.push(
        `${rel(file)} takes ${receivers.join(', ')} out of the tab order and registers no keydown listener.`,
        '    A roving tabindex with no arrow keys behind it leaves every unselected item reachable',
        '    by NO key — worse than the plain tab stops it replaced. Measured on four widgets.',
        '    Fix: `attachRovingFocus({ host, orientation, items, select })` from',
        `    ${ADWAITA_WEB_SRC}/elements/roving-focus.ts, or put the items inside an element that`,
        '    already handles the keys (the `<adw-popover>` shape).',
    );
}

if (problems.length > 0) fail('roving', problems);

const drift = [];
for (const [file, arm] of [...roving].sort(([a], [b]) => a.localeCompare(b))) {
    const declared = ROVING_LEDGER[file];
    if (declared === undefined) drift.push(`+ ${file} entered roving scope, discharged by: ${arm}`);
    else if (declared !== arm) drift.push(`~ ${file} is now discharged by "${arm}", ledgered as "${declared}"`);
}
for (const file of Object.keys(ROVING_LEDGER)) {
    if (!roving.has(file)) drift.push(`- ${file} left roving scope — respelled, or this reader stopped seeing it`);
}
if (drift.length > 0) {
    fail('roving', [
        ...drift,
        '',
        '    ROVING_LEDGER in this script is the exact in-scope set. Update it in the SAME commit,',
        '    so a widget dropping out of scope has to be argued for instead of merely counted:',
        '    respelling one assignment took the scan from 9 files to 8 and still printed OK.',
    ]);
}

// ---------------------------------------------------------------------------
// SPECS
// ---------------------------------------------------------------------------

const missingSpecs = CONTRACT_SPECS.filter((spec) => !existsSync(join(ROOT, spec)));
if (missingSpecs.length > 0) {
    fail('specs', [
        `${missingSpecs.join(', ')} — gone.`,
        '    This script holds that an implementation EXISTS; those two hold that it WORKS, and its',
        '    own header sends the reader to them. A pointer nothing checks is how the header of',
        '    modal-surface.ts came to cite `check-adwaita-modal-trap.mjs`, a script never written.',
    ]);
}

console.log(
    `check-adwaita-keyboard-contract: OK — aria-modal is declared once, in ${TRAP_MODULE}, which traps Tab; ` +
        `${roving.size} file(s) hand out a negative tabindex, each discharged by the arm ROVING_LEDGER ` +
        `declares; ${CONTRACT_SPECS.length} contract spec(s) present.`,
);

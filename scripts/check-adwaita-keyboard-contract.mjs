#!/usr/bin/env node
// A keyboard affordance adwaita-web DECLARES has an implementation behind it.
//
// THE INCIDENT
//
// Two shapes, one root: the widget announced a keyboard contract to assistive technology
// and to the browser, and then did not keep it. Both were measured in Firefox, and both
// were GREEN in a suite of 4321 assertions, because every one of them read state.
//
//   1. `aria-modal="true"` on four surfaces — `<adw-dialog>`, `<adw-alert-dialog>`,
//      `<adw-about-dialog>`, `<adw-preferences-dialog>` — honoured by ONE. Focus the last
//      control inside `<adw-alert-dialog>` and press Tab: focus landed on
//      `.adw-view-switcher-bar-button`, outside the dialog, behind its own scrim, on a
//      control the user cannot see. Closing then left it there — none of the three
//      returned focus to whatever opened them. `aria-modal` tells AT the rest of the page
//      is inert; it changes NOTHING about where the browser sends Tab.
//   2. `role="tablist"` / `role="listbox"` plus `tabIndex = -1` on every unselected item
//      — the roving tabindex — on four composites, with no keydown listener anywhere.
//      Three items, tabIndex `[0, -1, -1]`, and ArrowLeft/ArrowRight/ArrowUp/ArrowDown/
//      Home/End all left `document.activeElement` exactly where it was. The two
//      unselected items were reachable by NO key: the roving tabindex had taken them out
//      of the Tab order and nothing put them back. Strictly worse than the plain tab
//      stops it replaced.
//
// ONE SCRIPT, TWO ARMS, deliberately. They are the same invariant at two spellings, and
// the alternative is two more steps in BOTH copies of the required job for a rule that
// reads the same file set twice. Each arm names itself in its own failure, so attribution
// costs nothing.
//
// WHAT IT CHECKS
//
// TRAP — `setAttribute('aria-modal', …)` occurs EXACTLY ONCE in the package, in
// `elements/modal-surface.ts`, and that file both registers a keydown listener and
// handles `'Tab'`. So the declaration and the trap are the same call: a fifth modal
// surface cannot be added without one, and gutting the shared trap fails here rather
// than quietly in a browser. ZERO occurrences fails too — a declaration that vanished is
// either a modality no longer announced or a spelling this reader cannot see, and both
// are the blindness the gate exists to remove.
//
// ROVING — a file that assigns a NEGATIVE tabIndex to a repeated child must have a
// keydown listener behind it. "Repeated child" is derived from the RECEIVER: `this.<x>`
// is one fixed node this element owns, anything else (`item`, `row.el`, `nodes.button`)
// is built per item in a loop. Three arms count as "behind it", all DERIVED from the
// tree — there is no declaration marker, on purpose:
//
//   a. the file registers a keydown listener itself (`<adw-tab-view>`, `<adw-drop-down>`);
//   b. it CALLS an imported binding whose defining module registers one — `attachRovingFocus`
//      in `elements/roving-focus.ts`, `new AdwModalSurface` in `elements/modal-surface.ts`;
//   c. it creates an `<adw-…>` element by tag whose defining file registers one — the
//      `.adw-popover-item` rows `<adw-split-button>` and `<adw-menu-button>` build, which
//      `<adw-popover>` walks for arrow/Home/End/Enter.
//
// A `KEYNAV-BY:` header marker in the `CORE-VIA:` style was considered and REJECTED:
// every delegation in the tree today is visible as an import edge or a tag, so a marker
// would be an escape hatch nothing needs, and an unused escape hatch is what a later
// reader reaches for instead of fixing the widget. Add one when a real case cannot be
// derived — with the case in this header.
//
// WHAT IT DOES NOT CLAIM. That the trap or the arrow keys WORK. That is
// `packages/web/adwaita-web/src/keyboard-operable.spec.ts` (every surface and every
// composite, asserting `document.activeElement` after each press) and
// `tests/browser/specs/adwaita-keyboard.spec.ts` (the same under REAL key presses, which
// is the only way to reproduce the escape). This holds that an implementation EXISTS —
// the half a browser suite cannot hold for a widget nobody remembered to write a spec for.
//
// Usage: node scripts/check-adwaita-keyboard-contract.mjs [--root <dir>]

import { readFileSync } from 'node:fs';
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

function fail(arm, lines) {
    console.error(`check-adwaita-keyboard-contract [${arm}]: ${lines.join('\n  ')}`);
    process.exit(1);
}

const ARIA_MODAL = /setAttribute\(\s*['"`]aria-modal['"`]/g;
const KEYDOWN_LISTENER = /addEventListener\(\s*['"`]keydown['"`]/;
// `x.tabIndex = … -1 …` — the ternary `isActive ? 0 : -1` and the bare `-1` alike.
const NEGATIVE_TABINDEX = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\.tabIndex\s*=\s*([^;\n]*-\s*1[^;\n]*)/g;
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

const roving = [];
const problems = [];

for (const [file, text] of code) {
    const receivers = [...text.matchAll(NEGATIVE_TABINDEX)]
        .map(([, receiver]) => receiver)
        // `this.…` is ONE node this element owns — a dialog box, a sheet. A repeated child
        // is held by a local: `item`, `row.el`, `nodes.button`.
        .filter((receiver) => receiver !== 'this' && !receiver.startsWith('this.'));
    if (receivers.length === 0) continue;

    roving.push(rel(file));
    if (KEYDOWN_LISTENER.test(text)) continue;

    // (b) calls an imported binding whose module registers one.
    const viaImport = relativeImports(text).find(
        ({ spec, names }) =>
            names.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(text)) &&
            KEYDOWN_LISTENER.test(code.get(sibling(file, spec)) ?? ''),
    );
    if (viaImport !== undefined) continue;

    // (c) creates an <adw-…> element whose defining file registers one.
    const viaTag = [...text.matchAll(CREATE_ADW_ELEMENT)].map(([, tag]) => tag).find(tagHandlesKeys);
    if (viaTag !== undefined) continue;

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

// A floor, not a count: it grows without this file being edited. Zero files in scope would
// mean the receiver pattern stopped matching and every widget would pass vacuously —
// which is precisely how four of them passed for their whole lives.
if (roving.length === 0) {
    fail('roving', [
        'no file assigns a negative tabIndex to a repeated child. Either the package moved or',
        '    NEGATIVE_TABINDEX stopped matching — a scan with nothing in scope passes vacuously.',
    ]);
}

console.log(
    `check-adwaita-keyboard-contract: OK — aria-modal is declared once, in ${TRAP_MODULE}, which traps Tab; ` +
        `${roving.length} file(s) hand out a negative tabIndex and every one has a keydown listener behind it.`,
);

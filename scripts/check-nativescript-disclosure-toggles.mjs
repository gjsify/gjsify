#!/usr/bin/env node
// A disclosure's toggle is wired to the HEADER, never to the whole row.
//
// WHY A SOURCE SCAN AND NOT A TEST
//
// `AdwExpanderRow extends AdwActionRow extends GridLayout`, so the class evaluates
// the bare `@nativescript/core` specifier at module load and cannot be imported
// off-device. No spec in the renderer suite can construct one, which is precisely
// how the defect in #1155 survived: the whole affordance for expanding a row was
// the 16-unit chevron, on the port whose targets are fingers, and 3000+ green
// tests could not see it.
//
// WHAT THE DEVICE SAID, and why it decides the shape (measured on the Android
// emulator, 2026-08-14, storybook Expander Row story):
//
//   tap target                      child listener   the ROW's own `tap`
//   plain Label in the disclosure    fires            FIRES
//   nested switch row                fires            FIRES
//   nested entry row                 –                – (native EditText eats it)
//   the header                       –                fires
//   the 16x16 chevron                fires            FIRES
//
// A NativeScript `tap` does NOT stop at a child that handles it. So toggling from
// the row's own `tap` — or from `activate()`, which that listener calls — collapses
// the row whenever a user touches anything inside it. libadwaita avoids the same
// trap structurally: `activatable=False` on the expander, True on the inner header
// row (adw-expander-row.ui:24-26), so revealed rows cannot toggle their parent.
//
// Siblings do NOT receive each other's taps, which is what makes header-scoped
// listeners safe and is the whole reason the wiring must stay header-scoped.
//
// WHAT IT CHECKS
//
// In each listed widget, the disclosure-toggling listener may only be attached to a
// header-scoped view. Attaching it to `this` (the row, an ancestor of the
// disclosure) or to the disclosure container fails — those are the two spellings
// that put the toggle in the path of every nested tap.
//
// Plain Node over the repo's own files — no install, no build, no device.
//
// Usage: node scripts/check-nativescript-disclosure-toggles.mjs [--root <dir>]

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const NS_WIDGETS = join(ROOT, 'packages/nativescript-bridge/adwaita/src/widgets');

/**
 * Widgets that reveal nested content, and the receiver their toggle must NOT be on.
 *
 * `state.toggle()` is the call that flips a disclosure; the scan looks at which
 * object the listener carrying it was registered on.
 */
const GUARDED = [
    {
        file: 'adw-expander-row.ts',
        /** The call that flips the disclosure. */
        toggle: '_state.toggle()',
        /** Receivers that are ancestors of the revealed content. */
        forbidden: ['this.addEventListener', 'disclosure.addEventListener', 'this._disclosure.addEventListener'],
    },
];

const failures = [];
let checked = 0;

for (const widget of GUARDED) {
    const path = join(NS_WIDGETS, widget.file);
    let source;
    try {
        source = readFileSync(path, 'utf8');
    } catch {
        failures.push(`${widget.file} is listed here but does not exist — the scan is stale, not the widget.`);
        continue;
    }

    if (!source.includes(widget.toggle)) {
        failures.push(
            `${widget.file} no longer calls \`${widget.toggle}\`, so this scan is watching a call that moved. ` +
                'Point it at the new one rather than deleting the guard.',
        );
        continue;
    }

    // The listener bodies that toggle, and what each was registered on. A body is
    // the arrow function passed to addEventListener, or a named handler assigned
    // once and attached by reference.
    const togglingHandlers = new Set();
    for (const match of source.matchAll(/const\s+(\w+)\s*=\s*\(\)\s*=>\s*\{([^}]*)\}/g)) {
        if (match[2].includes(widget.toggle)) togglingHandlers.add(match[1]);
    }

    for (const receiver of widget.forbidden) {
        // Inline form: `<receiver>('tap', () => { … state.toggle() … })`.
        //
        // The gap is `[\s\S]{0,300}?`, NOT `[^)]*?`: an arrow function's own `()`
        // ends a negated-paren run immediately, so the tighter-looking pattern
        // matched nothing and the gate passed the very defect it exists for. Found by
        // A/B-ing both spellings rather than only the one written first.
        const inline = new RegExp(
            `${receiver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(\\s*'tap'\\s*,[\\s\\S]{0,300}?${widget.toggle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
            's',
        );
        if (inline.test(source)) {
            failures.push(
                `${widget.file}: \`${receiver}('tap', …)\` toggles the disclosure. That receiver is an ANCESTOR of ` +
                    'the revealed content, and a NativeScript tap does not stop at the child that handles it — ' +
                    'so every tap inside the row would collapse it.',
            );
        }
        // By-reference form: `<receiver>('tap', toggleOnTap)`
        for (const handler of togglingHandlers) {
            if (source.includes(`${receiver}('tap', ${handler})`)) {
                failures.push(
                    `${widget.file}: \`${receiver}('tap', ${handler})\` puts the disclosure toggle on an ancestor ` +
                        'of the revealed content; a tap on any nested child would collapse the row.',
                );
            }
        }
    }
    checked++;
}

if (failures.length > 0) {
    console.error(`check-nativescript-disclosure-toggles: ${failures.length} problem(s):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
        `\nAttach the toggle to a HEADER-scoped view instead (the title stack, the chevron). Siblings do not\n` +
            `receive each other's taps, which is what makes that safe — measured on device, see this file's header.\n` +
            `  widgets: ${relative(ROOT, NS_WIDGETS)}`,
    );
    process.exit(1);
}

console.log(`check-nativescript-disclosure-toggles: ${checked} disclosure widget(s), all toggling from the header.`);

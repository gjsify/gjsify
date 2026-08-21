// What each Adwaita renderer ships, read from the code that registers it.
//
// THE INCIDENT
//
// Three scripts needed one fact — which elements adwaita-web ships — and derived it
// separately. `check-adwaita-reset-components.mjs` scanned `customElements.define`
// over all of `src/`; `generate-status.mjs` and `check-storybook-widget-coverage.mjs`
// each listed FILENAMES matching `adw-*.ts` in `src/elements/`, non-recursively. Same
// CI job, 65 against 50, and the smaller answer fed the published widget matrix.
//
// A filename is not the element. `adw-checks.ts` defines `adw-checkbox` and
// `adw-radio`: the matrix scored a widget no page can use, and none for either it can.
// `adw-preferences-dialog.ts` also defines `adw-preferences-page`, so the matrix
// published "adwaita-web does not have it" about an element consumers already use.
// `adw-source-view` sits in `src/source-view/`, invisible to both filename readers —
// the same blindness that had kept it out of the ADR 0010 reset list.
//
// So this module is the ONE reader, of BOTH renderers: the NativeScript widget scan
// was a second copy in the same two files, with the same drift ahead of it. `adw-` is
// the whole naming rule the tree follows, which is what lets a tag address a matrix
// row — {@link elementName} strips it, and the rest is the bare name the NativeScript
// files and the `*.meta.ts` story names are already spelled in.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Repo-relative source roots, so callers can name them in their own messages. */
export const ADWAITA_WEB_SRC = 'packages/web/adwaita-web/src';
export const ADWAITA_NS_WIDGETS = 'packages/nativescript-bridge/adwaita/src/widgets';

// Both quote styles: the formatter uses single, but a matcher that only sees one
// is a matcher that misses a rename.
const DEFINE_PATTERN = /customElements\s*\.\s*define\(\s*['"](adw-[a-z0-9-]+)['"]/g;

/** Every `.ts` under `dir` — elements live outside `elements/` too (`source-view/`). */
function sourceFiles(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...sourceFiles(path));
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) found.push(path);
    }
    return found;
}

/** `adw-preferences-page` → `preferences-page`: the key rows, ledger entries and stories share. */
export const elementName = (tag) => tag.slice('adw-'.length);

/**
 * Every custom element adwaita-web defines → the file defining it, so a failure
 * can name the file to open. Sorted by tag; several files define two or three.
 *
 * THROWS on an empty scan: nothing is missing from an empty set, so a reader that
 * finds nothing lets every consumer pass vacuously — which is exactly what a moved
 * package or a stale pattern produces.
 *
 * @param {string} root repository root
 * @returns {Map<string, string>} tag → repo-relative defining file
 */
export function adwaitaWebElements(root) {
    const src = join(root, ADWAITA_WEB_SRC);
    /** @type {Map<string, string>} */
    const defined = new Map();
    for (const file of sourceFiles(src)) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(DEFINE_PATTERN)) defined.set(match[1], relative(root, file));
    }

    if (defined.size === 0) {
        throw new Error(
            `no customElements.define('adw-…') calls found under ${ADWAITA_WEB_SRC}. ` +
                'Either the package moved or DEFINE_PATTERN stopped matching — a scan that ' +
                'finds nothing passes vacuously, so this is a failure, not a pass.',
        );
    }

    return new Map([...defined].sort(([a], [b]) => a.localeCompare(b)));
}

const EXPORTED_CLASS = /export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/g;

/** `preferences-page` → `AdwPreferencesPage`, the class `adw-preferences-page.ts` must export. */
const widgetClass = (name) =>
    `Adw${name
        .split('-')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join('')}`;

/**
 * Every widget the NativeScript Adwaita port ships → its repo-relative file.
 *
 * NativeScript has no `customElements.define`. A widget here is a class extending a
 * `@nativescript/core` view, named `Adw<Widget>` in `adw-<name>.ts` — 46 files of 47.
 * The 47th is `adw-accent.ts`, two functions that push CSS at `Application`: no view,
 * nothing to place in a layout, and the directory listing scored it as a
 * NativeScript-only WIDGET the browser had yet to port.
 *
 * NO CLASS is therefore the exemption and the only one: a file exporting classes but
 * not the one its name promises THROWS rather than quietly leaving the widget set,
 * which is how a rename would otherwise shrink every consumer's input without failing
 * anything. Same vacuous-scan contract as {@link adwaitaWebElements}.
 *
 * @param {string} root repository root
 * @returns {Map<string, string>} bare widget name → repo-relative file
 */
export function adwaitaNativeScriptWidgets(root) {
    const dir = join(root, ADWAITA_NS_WIDGETS);
    /** @type {Map<string, string>} */
    const widgets = new Map();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const match = entry.isFile() && !entry.name.endsWith('.spec.ts') && /^adw-(.+)\.ts$/.exec(entry.name);
        if (!match) continue;
        const file = join(dir, entry.name);
        const classes = [...readFileSync(file, 'utf8').matchAll(EXPORTED_CLASS)].map(([, name]) => name);
        const expected = widgetClass(match[1]);
        if (classes.includes(expected)) widgets.set(match[1], relative(root, file));
        else if (classes.length > 0) {
            throw new Error(
                `${relative(root, file)} exports ${classes.join(', ')} but not ${expected}. ` +
                    'A widget file names its class after itself; without that this file drops out ' +
                    'of the widget set silently, and every consumer of it shrinks with no failure.',
            );
        }
    }

    if (widgets.size === 0) {
        throw new Error(
            `no adw-<name>.ts file under ${ADWAITA_NS_WIDGETS} exports an Adw* class. ` +
                'Either the package moved or the naming convention changed — a scan that ' +
                'finds nothing passes vacuously, so this is a failure, not a pass.',
        );
    }

    return new Map([...widgets].sort(([a], [b]) => a.localeCompare(b)));
}

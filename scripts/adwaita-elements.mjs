// The adwaita-web element set, read from the calls that create it.
//
// THE INCIDENT
//
// Three scripts need the same fact — which custom elements adwaita-web ships —
// and three scripts derived it separately. `check-adwaita-reset-components.mjs`
// scanned `customElements.define` over all of `src/`; `generate-status.mjs` and
// `check-storybook-widget-coverage.mjs` each listed FILENAMES matching
// `adw-*.ts` in `src/elements/`, non-recursively. In the same CI job the first
// reported 65 elements and the other two 50, and the smaller number was the one
// feeding the published widget matrix.
//
// A filename is not the element. `adw-checks.ts` defines `adw-checkbox` and
// `adw-radio`, so the matrix scored a widget `adw-checks` that no page can use
// and had no row for either that it can. `adw-preferences-dialog.ts` also
// defines `adw-preferences-page`, so the matrix stated adwaita-web does not have
// a preferences page while consumers were using one. `adw-source-view` lives in
// `src/source-view/` and was invisible to both filename readers — the same
// blindness that had already kept it out of the ADR 0010 reset list.
//
// So this module is the ONE reader. `adw-` is the whole naming rule the tree
// follows, which is what lets a tag address a matrix row: {@link elementName}
// strips it, and what is left is the bare widget name the NativeScript widget
// files and the storybook `*.meta.ts` names are already spelled in.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Repo-relative source root, so callers can name it in their own messages. */
export const ADWAITA_WEB_SRC = 'packages/web/adwaita-web/src';

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

/**
 * The tag every matrix row, ledger entry and story name is keyed by.
 *
 * @param {string} tag e.g. `adw-preferences-page`
 * @returns {string} e.g. `preferences-page`
 */
export const elementName = (tag) => tag.slice('adw-'.length);

/**
 * Every custom element adwaita-web defines → the file defining it, so a failure
 * can name the file to open. Sorted by tag; several files define two or three.
 *
 * THROWS on an empty scan. A reader that finds nothing lets every consumer pass
 * vacuously — the tag set is empty, so nothing is missing from anything — and
 * that is exactly the state a moved package or a stale pattern produces. It is
 * a failure, not a pass.
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

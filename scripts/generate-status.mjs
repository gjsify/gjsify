/**
 * STATUS.md generator — the status snapshot as DATA, not prose.
 *
 * WHAT PROBLEM THIS SOLVES
 *
 * STATUS.md used to be a 1600-line hand-maintained document whose package
 * tables, tier lists, runtime slots and metrics RESTATED facts that are already
 * true in the repo (`package.json#gjsify.tier`, `gjsify.runtimes`,
 * `gjsify.platforms`, the workspace globs, the spec files on disk). Prose
 * cannot be validated, so every hand-copied number was a drift waiting to be
 * discovered by a reader — and several were (package counts, refs-submodule
 * counts, whole package groups missing from the tables).
 *
 * The fix is the same one this repo applies everywhere else
 * (`@gjsify/manifest-conformance` derives checks from declarations,
 * `verify-package-outputs` derives the path set from `workspaces` globs):
 * anything DERIVABLE is derived at generation time, and only what genuinely
 * needs a human is AUTHORED — in `status/`:
 *
 *   - `status/status.json`                       per-package status + notes
 *   - `status/integration-coverage.md`           per-suite notes (## <dir>)
 *   - `status/open-todos.md`                     open work (### <title>)
 *   - `status/upstream-patch-candidates.md`      upstream workaround table
 *   - `status/sections/*.md`                     fixed set of free-form sections
 *
 * `node scripts/generate-status.mjs` (`npm run status:generate`) renders the
 * whole snapshot into STATUS.md on demand.
 *
 * THE RENDERED FILE IS NOT COMMITTED (ADR 0016 amendment)
 *
 * STATUS.md is gitignored: a rendered view you produce when you want to read
 * one, never a tracked artifact. Two reasons, both measured:
 *
 *   - Committing it would put a file DERIVED FROM EVERY MANIFEST under a
 *     freshness contract, which serialises unrelated PRs: PR A touches package
 *     X, PR B touches package Y, each regenerates against its own base — A
 *     merges and B's copy is stale through no fault of B's.
 *   - The derived facts are read off the DISK, not off git (directory listings
 *     under `examples/`, `showcases/`, `tests/`), so the output legitimately
 *     differs between two correct checkouts. That is not hypothetical: the
 *     commit introducing this generator baked `68` examples from a tree with
 *     untracked scratch directories, against the 63 a clean checkout counts,
 *     and no amount of care by the author could have made those agree.
 *
 * What REMAINS enforced is the half that has a right answer: the authored data
 * under `status/` is schema-checked and cross-checked against the manifests by
 * the `status-data` conformance rule on every PR. Anything derived is computed
 * fresh at the moment somebody asks for it, and can therefore never be stale.
 *
 * DESIGN RULES
 *
 * - NO dependencies, plain Node — the validation half runs in the
 *   `audit-runtimes.yml` job, which does no install and no build (same
 *   constraint as the rest of the conformance family; routing it through the
 *   CLI bundle would reintroduce the staleness circularity
 *   `verify-committed-bundles.mjs` breaks).
 * - The authored file CANNOT restate a derivable fact: `status/status.json`
 *   entries allow only `status`/`note`/`working`/`missing`, so an authored
 *   `tier` or `runtimes` key is a validation FAILURE, not a second source of
 *   truth that can contradict the manifest.
 * - Deterministic output: every list is sorted, every scan is stable — so two
 *   renders of the same tree agree, and a reader can diff two runs.
 * - The DERIVED numbers have one machine-read consumer, and it reads them
 *   STRUCTURALLY: `website/scripts/generate-coverage.mjs` imports
 *   `collectSummaryCounts()` below rather than re-parsing a Markdown table.
 *   Never reintroduce a text-parsing consumer of the rendered output.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    isPlatformPackageManifest,
    prebuildOwnership,
} from '../packages/infra/manifest-conformance/lib/platform-packages.mjs';
import { posixRelative } from '../packages/infra/manifest-conformance/lib/index.mjs';
import { adwaitaNativeScriptWidgets, adwaitaWebElements, coreReach, elementName } from './adwaita-elements.mjs';

// ─── Authored-data model ────────────────────────────────────────────────────

/** Legal values for an authored package `status`. */
export const PACKAGE_STATUSES = new Set(['full', 'partial', 'stub', 'meta', 'native', 'poc']);

/** Keys an authored package entry may carry — anything else is a failure. */
const PACKAGE_ENTRY_KEYS = new Set(['status', 'note', 'working', 'missing']);

/**
 * The fixed set of free-form authored sections under `status/sections/`.
 * The generator renders exactly these, in this order at their anchor points;
 * an unknown file in the directory is a validation failure so a new section
 * cannot be added without also being rendered.
 */
export const SECTION_FILES = [
    'summary-notes.md',
    'webrtc-status.md',
    'adwaita-web-roadmap.md',
    'webgl-known-issues.md',
    'priorities.md',
];

// ─── Repo scanning (all derived facts come from here) ───────────────────────

const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', '.git', 'fixtures', 'prebuilds', 'refs', 'build']);

/** @param {string} dir */
function readManifest(dir) {
    try {
        return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
        return null;
    }
}

/** Recursively collect package dirs (a dir holding package.json is a leaf). */
function packagesUnder(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    if (entries.some((e) => e.isFile() && e.name === 'package.json')) {
        out.push(dir);
        return out;
    }
    for (const entry of entries) {
        if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
        packagesUnder(join(dir, entry.name), out);
    }
    return out;
}

/** List immediate subdirectories that exist. */
function subdirs(dir) {
    try {
        return readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort();
    } catch {
        return [];
    }
}

/** Recursively list files below `dir` matching `re` (skips SKIP_DIRS). */
function listFiles(dir, re, out = []) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) listFiles(abs, re, out);
        } else if (re.test(entry.name)) {
            out.push(abs);
        }
    }
    return out;
}

/** `gi://<Ns>?version=<v>` and bare `cairo` imports in a package's sources. */
const GI_IMPORT_RE = /gi:\/\/([A-Za-z][A-Za-z0-9]*)(?:\?version=([0-9.]+))?/g;

/** `@girs/<base>` value imports in source (the GJS-only signal per AGENTS.md). */
const GIRS_IMPORT_RE = /from ['"]@girs\/([a-z0-9.-]+)['"]/g;

/**
 * Which GNOME namespaces a package reaches, normalised to the `@girs/*`-style
 * lowercase token (`gio-2.0`, `soup-3.0`, `cairo`). Two sources, both needed:
 * `gi://` specifiers in `src/` (the drift-check signal) and `@girs/*` VALUE
 * imports (many packages import the namespace through the generated types).
 * Versioned tokens win over unversioned ones for the same namespace; the
 * `gjs` runtime-types package is noise and excluded.
 */
function scanGnomeNamespaces(pkgDir) {
    /** namespace base (lowercase) → full token (versioned when known) */
    const byBase = new Map();
    const add = (token) => {
        const base = token.replace(/-[0-9.]+$/, '');
        // `gjs` = the runtime-types package (noise on every GJS package);
        // `ns`/`gjsify` = codegen placeholders (`gi://Ns?version=…`,
        // `gi://Gjsify<name>`) in build tooling that WRITES gi:// imports.
        if (base === 'gjs' || base === 'ns' || base === 'gjsify') return;
        const existing = byBase.get(base);
        if (!existing || (existing === base && token !== base)) byBase.set(base, token);
    };
    const srcDir = join(pkgDir, 'src');
    const files = listFiles(existsSync(srcDir) ? srcDir : pkgDir, /\.(m?ts|mjs|js)$/);
    for (const file of files.sort()) {
        if (/\.(spec|test)\./.test(file)) continue;
        let src;
        try {
            src = readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        for (const match of src.matchAll(GI_IMPORT_RE)) {
            add(match[2] ? `${match[1].toLowerCase()}-${match[2]}` : match[1].toLowerCase());
        }
        for (const match of src.matchAll(GIRS_IMPORT_RE)) add(match[1]);
        if (/from ['"]cairo['"]/.test(src)) add('cairo');
    }
    return [...byBase.values()].sort();
}

/**
 * Per-widget Adwaita coverage across the three renderers, DERIVED.
 *
 * The Adwaita identity ships as three parallel ports (GTK stories, browser
 * Custom Elements, NativeScript views) plus the shared headless behaviour in
 * `@gjsify/adwaita-core`. Which widget exists where, and which of them actually
 * delegate to core, is fully readable from the tree — so it must never be
 * maintained by hand. It WAS, in `status/sections/adwaita-web-roadmap.md`, and
 * it drifted: twelve widgets sat under "Planned" long after they shipped.
 *
 * ONE ROW PER `adw-<name>`, read from what each renderer REGISTERS, which is a
 * different thing on each: `customElements.define('adw-…')` tags minus the prefix
 * ({@link elementName}), NativeScript `Adw*` view classes, GTK `<name>.meta.ts`
 * stories. The three vocabularies agree on the bare name, so this needs no alias
 * table. Upstream partials that no renderer has yet are a genuinely authored
 * judgement (three naming conventions) and stay in the roadmap section.
 *
 * Both renderer columns were FILENAME scans, which is not the same question — the
 * phantom `adw-checks`, the denied `adw-preferences-page`, the invisible
 * `adw-source-view` and the accent function pair scored as a widget are the
 * incident in `scripts/adwaita-elements.mjs`.
 *
 * TWO false gaps this used to score, both fixed by DERIVING harder rather than
 * by an exception list — an allowlist here would reintroduce exactly the
 * hand-maintenance that let the old table drift twelve widgets behind:
 *
 *   - `adw-toast` read as MISSING on both renderers. Upstream `Adw.Toast` is a
 *     DATA object: it has no widget of its own, it is state that
 *     `adw-toast-overlay` renders. The derivable signal is the shape itself — a
 *     story exists, no renderer element does, and `@gjsify/adwaita-core` has a
 *     module of that name — so it is reported as modelled-in-core instead of as
 *     a hole in two ports.
 *   - Widgets served by a SHARED helper read as not-core-backed. The lookup was
 *     `<widget>.ts` / `<widget>-color.ts`, i.e. a naming convention, so
 *     `chrome.ts` (which imports core and serves the spinner among others) was
 *     invisible and `adw-spinner` scored as duplicated behaviour on NativeScript
 *     while it was already sharing it. The edge is now followed instead of
 *     guessed at, one hop through the package's own modules.
 */
function collectAdwaitaCoverage(root) {
    const absolute = (entries) => new Map([...entries].map(([name, file]) => [name, resolve(root, file)]));

    // `adw-sidebar.ts` defines three tags, so three rows point at the same file.
    const web = absolute([...adwaitaWebElements(root)].map(([tag, file]) => [elementName(tag), file]));
    const ns = absolute(adwaitaNativeScriptWidgets(root));

    // The GTK renderer's coverage IS its story set (one `.meta.ts` per widget).
    const stories = new Set();
    const storyDir = join(root, 'showcases/gtk/adwaita-storybook/src');
    for (const file of listFiles(existsSync(storyDir) ? storyDir : root, /\.meta\.ts$/)) {
        const base = file.split('/').pop() ?? '';
        stories.add(base.replace(/\.meta\.ts$/, ''));
    }

    // The rule, its two incidents and the `CORE-VIA:` declaration it honours live with
    // the reader — where the two CI gates inherit them (`scripts/adwaita-elements.mjs`).
    const reachesCore = coreReach(new Set([...web.values(), ...ns.values()]), root);

    // Upstream data objects — `Adw.Toast` is state, not a widget, and the renderer
    // that draws it is a different one (`adw-toast-overlay`). Derived from the
    // shape rather than named: a story, no renderer element anywhere, and a core
    // module of that name. Scored as a two-renderer hole it was pure noise.
    const coreModule = (name) => existsSync(join(root, 'packages/web/adwaita-core/src', `${name}.ts`));

    const all = [...new Set([...web.keys(), ...ns.keys(), ...stories])].sort();
    return all.map((name) => {
        const webFile = web.get(name);
        const nsFile = ns.get(name);
        return {
            name,
            story: stories.has(name),
            web: Boolean(webFile),
            ns: Boolean(nsFile),
            webCore: Boolean(webFile && reachesCore(webFile)),
            nsCore: Boolean(nsFile && reachesCore(nsFile)),
            dataObject: !webFile && !nsFile && stories.has(name) && coreModule(name),
        };
    });
}

/** Statically count spec files + `it(` call sites — NOT runtime test totals. */
function scanSpecStats(pkgDir) {
    const specs = listFiles(join(pkgDir, 'src'), /\.spec\.(m?ts|tsx)$/);
    let itSites = 0;
    for (const file of specs) {
        try {
            itSites += (readFileSync(file, 'utf8').match(/\bit\(/g) ?? []).length;
        } catch {
            /* unreadable spec counts as zero */
        }
    }
    return { specFiles: specs.length, itSites };
}

/**
 * @typedef {object} PackageFacts
 * @property {string} name
 * @property {string} rel        e.g. `packages/node/fs`
 * @property {string} pillar     `node|web|dom|framework|gjs|infra|nativescript-bridge|node-gi|napi`
 * @property {boolean} private
 * @property {number|undefined} tier
 * @property {Record<string,string>|undefined} runtimes
 * @property {string[]} platforms
 * @property {boolean} hasPrebuilds
 * @property {string[]} gnome
 * @property {{specFiles: number, itSites: number}} tests
 * @property {boolean} browserTest
 */

/**
 * Does this package carry native artifacts at all?
 *
 * The same three signals `collectNativePackages()` gates on — a native build
 * system in-tree, or a committed prebuild directory, or an OS-axis declaration.
 * Spelled out here rather than imported because that collector needs a full
 * conformance context and this file only ever has a directory and a manifest.
 *
 * @param {string} dir
 * @param {Record<string, any>} gjsify the manifest's `gjsify` object
 */
function isNativePackage(dir, gjsify) {
    if (typeof gjsify.prebuilds === 'string') return true;
    if (Array.isArray(gjsify.platforms) && gjsify.platforms.length > 0) return true;
    return existsSync(join(dir, 'meson.build')) || existsSync(join(dir, 'binding.gyp'));
}

/** Collect the derived facts for every package under `packages/`. @param {string} root */
export function collectPackageFacts(root) {
    /** @type {PackageFacts[]} */
    const facts = [];
    for (const dir of packagesUnder(join(root, 'packages'))) {
        const manifest = readManifest(dir);
        if (!manifest) continue;
        // Per-target platform packages (ADR 0017) are excluded from the status
        // model entirely — from the counts, from the tables and from the authored
        // coverage requirement. Requiring an entry would mean 51 hand-written
        // notes whose only possible content is "the linux-x64 binary of
        // <bridge>", i.e. the derivable fact this file explicitly forbids
        // authoring. The bridge's own entry is the status of its artifacts; a
        // second row per target adds no judgement a human made.
        if (isPlatformPackageManifest(manifest)) continue;
        const rel = posixRelative(root, dir);
        const pillar = rel.split('/')[1];
        const gjsify = manifest.gjsify && typeof manifest.gjsify === 'object' ? manifest.gjsify : {};
        facts.push({
            name: typeof manifest.name === 'string' ? manifest.name : rel,
            rel,
            pillar,
            private: manifest.private === true,
            tier: gjsify.tier,
            runtimes: gjsify.runtimes,
            platforms: Array.isArray(gjsify.platforms) ? gjsify.platforms : [],
            // "This package's committed binaries exist somewhere", NOT "in this
            // tarball". Since ADR 0017 a split bridge owns artifacts it does not
            // contain — they live in its per-target packages — so keying the
            // fact on `gjsify.prebuilds` alone made all six split bridges
            // contradict their own authored `native` status the moment the split
            // landed. `prebuildOwnership()` is the shared derivation, the same
            // one `prebuild-artifacts` and the `platform-packages` rule use, so
            // the three cannot disagree about which state a bridge is in.
            //
            // GATED on the package being native at all, because that function
            // takes a row that is already known to be one: its `builder` is a
            // two-way split on `binding.gyp`, so a pure-TypeScript package with
            // neither build system would come back `'split'` and be allowed to
            // claim a `native` status it has no binary for.
            hasPrebuilds: isNativePackage(dir, gjsify)
                ? prebuildOwnership({
                      prebuildsField: typeof gjsify.prebuilds === 'string' ? gjsify.prebuilds : null,
                      builder: existsSync(join(dir, 'binding.gyp')) ? 'node-gyp' : 'meson',
                  }) !== 'install-time'
                : false,
            gnome: scanGnomeNamespaces(dir),
            tests: scanSpecStats(dir),
            browserTest: existsSync(join(dir, 'src', 'test.browser.mts')),
        });
    }
    facts.sort((a, b) => a.rel.localeCompare(b.rel));
    return facts;
}

// ─── Open-TODO anchors ──────────────────────────────────────────────────────

/**
 * The `### <title>` sections of `status/open-todos.md`, each with the BODY up to the
 * next heading.
 *
 * ONE parse, TWO consumers: this file resolves deferral markers against the headings,
 * `check-storybook-widget-coverage.mjs` resolves a `gap` field the marker rule cannot
 * structurally see. Its own copy had already drifted — emphasis stripped from the
 * heading but not the anchor, so a `gap` quoting a heading VERBATIM was rejected there
 * and accepted here.
 *
 * @param {string} text
 * @returns {{heading: string, body: string}[]}
 */
export function todoSections(text) {
    const headings = [...text.matchAll(/^### ([^\n]+)$/gm)];
    return headings.map((match, index) => ({
        heading: match[1].trim(),
        body: text.slice(match.index, headings[index + 1]?.index ?? text.length),
    }));
}

/**
 * The sections `anchor` names, or an empty list. Emphasis stripped from BOTH sides — a
 * heading may spell a symbol as `code`, a marker in a comment is plain text, and an
 * anchor quoting the heading carries the punctuation along; all three must reach the
 * same section. Containment, not equality: an anchor is a short handle against a whole
 * sentence, so equality would force every marker to restate a title.
 *
 * @param {{heading: string, body: string}[]} sections
 * @param {string} anchor
 */
export function todoAnchorMatches(sections, anchor) {
    const plain = (text) => text.replaceAll(/[`*_]/g, '');
    return sections.filter((section) => plain(section.heading).includes(plain(anchor)));
}

// ─── Authored-data loading + validation ─────────────────────────────────────

/**
 * Load and structurally validate everything under `status/`.
 * Returns `{ data, failures }` — validation problems are collected, not thrown,
 * so the conformance rule can report them all at once.
 *
 * @param {string} root
 * @param {PackageFacts[]} facts
 */
export function loadStatusData(root, facts) {
    const failures = [];
    const statusDir = join(root, 'status');
    const read = (name) => {
        const path = join(statusDir, name);
        if (!existsSync(path)) {
            failures.push(
                `status/${name} is missing — it is an authored input of scripts/generate-status.mjs and must exist.`,
            );
            return '';
        }
        return readFileSync(path, 'utf8');
    };

    /** @type {{packages?: Record<string, Record<string, string>>}} */
    let json = {};
    try {
        json = JSON.parse(read('status.json') || '{}');
    } catch (err) {
        failures.push(`status/status.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const packages = json.packages && typeof json.packages === 'object' ? json.packages : {};

    // Schema: only the four keys, status from the enum, partial ⇒ missing.
    for (const [name, entry] of Object.entries(packages)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            failures.push(`status/status.json: entry for ${name} must be an object.`);
            continue;
        }
        for (const key of Object.keys(entry)) {
            if (!PACKAGE_ENTRY_KEYS.has(key)) {
                failures.push(
                    `status/status.json: ${name} carries the key \`${key}\` — allowed keys are ` +
                        `${[...PACKAGE_ENTRY_KEYS].join('/')}. Derivable facts (tier, runtimes, platforms, test ` +
                        'counts) must NOT be authored here; they come from the package manifest at generation time.',
                );
            }
        }
        if (!PACKAGE_STATUSES.has(entry.status)) {
            failures.push(
                `status/status.json: ${name} has status \`${entry.status}\` — expected one of ${[...PACKAGE_STATUSES].join('/')}.`,
            );
        }
        if (typeof entry.note !== 'string' || entry.note.trim() === '') {
            failures.push(`status/status.json: ${name} needs a non-empty \`note\`.`);
        }
        if (entry.status === 'partial' && (typeof entry.missing !== 'string' || entry.missing.trim() === '')) {
            failures.push(
                `status/status.json: ${name} is \`partial\` — say WHAT is missing in a \`missing\` field ` +
                    '(that gap is the whole point of the partial status).',
            );
        }
        if (entry.status !== 'partial' && (entry.working !== undefined || entry.missing !== undefined)) {
            failures.push(
                `status/status.json: ${name} is \`${entry.status}\` but carries working/missing — those fields ` +
                    'belong to partial packages only; fold the content into `note`.',
            );
        }
    }

    // Coverage: every non-private package has an entry, every entry has a package.
    const byName = new Map(facts.map((f) => [f.name, f]));
    for (const fact of facts) {
        if (fact.private) continue;
        if (!packages[fact.name]) {
            failures.push(
                `${fact.name} (${fact.rel}) has no entry in status/status.json — every published package under ` +
                    'packages/ needs an authored status. Add `{ "status": …, "note": … }` for it.',
            );
        }
    }
    for (const name of Object.keys(packages)) {
        const fact = byName.get(name);
        if (!fact) {
            failures.push(
                `status/status.json names ${name}, but no such package exists under packages/ — delete the entry ` +
                    '(a status for a package that is gone is exactly the drift this file exists to prevent).',
            );
            continue;
        }
        if (packages[name].status === 'native' && !fact.hasPrebuilds) {
            failures.push(
                `status/status.json declares ${name} as \`native\`, but its manifest declares no \`gjsify.prebuilds\` — ` +
                    'a native bridge without a prebuild directory contradicts the manifest.',
            );
        }
    }

    // Integration coverage: `## <dir>` headings ↔ tests/integration/* dirs.
    const integrationMd = read('integration-coverage.md');
    const suiteDirs = subdirs(join(root, 'tests', 'integration'));
    const suiteHeadings = [...integrationMd.matchAll(/^## ([^\n]+)$/gm)].map((m) => m[1].trim());
    for (const dir of suiteDirs) {
        if (!suiteHeadings.includes(dir)) {
            failures.push(
                `tests/integration/${dir} has no \`## ${dir}\` section in status/integration-coverage.md — every ` +
                    'suite gets a note (what it validates, its current counts), even a one-liner.',
            );
        }
    }
    for (const heading of suiteHeadings) {
        if (!suiteDirs.includes(heading)) {
            failures.push(
                `status/integration-coverage.md has a \`## ${heading}\` section but tests/integration/${heading} ` +
                    'does not exist — headings must name suite directories verbatim.',
            );
        }
    }

    // Open TODOs: `### <title>` sections; a resolved TODO is DELETED, never
    // struck through — that rule is now machine-checked instead of remembered.
    const todosMd = read('open-todos.md');
    const todoSectionList = todoSections(todosMd);
    const todoHeadings = todoSectionList.map((section) => section.heading);
    if (todosMd && todoHeadings.length === 0) {
        failures.push('status/open-todos.md has no `### <title>` sections — one heading per open TODO.');
    }
    for (const heading of todoHeadings) {
        if (heading.includes('~~') || /^Completed\b/.test(heading) || heading.includes('✓')) {
            failures.push(
                `status/open-todos.md: "${heading}" looks resolved (strike-through / ✓ / Completed). A resolved ` +
                    'TODO is DELETED — its record is the commit + CHANGELOG that closed it (AGENTS.md § Project ' +
                    'status & CHANGELOG.md maintenance).',
            );
        }
    }

    // The OTHER direction, and it is the same class as the corpse check above.
    //
    // `gjsify/todo-needs-anchor` requires a deferral marker to anchor to `#123`,
    // a forge URL, `open-todos` or `fixed upstream in …`. For the `open-todos`
    // form the rule only looks for the SUBSTRING — nothing ever compared the
    // text after it against a heading that exists. So a marker could cite a
    // section that was renamed or deleted (this file DELETES a resolved entry by
    // design, which is exactly when it happens) and stay green forever, pointing
    // a reader at nothing. A corpse is a heading with no work left; a dangling
    // anchor is work with no heading. Both are the ledger disagreeing with
    // reality, so both belong here.
    //
    // How an anchor reaches a heading is {@link todoAnchorMatches}, shared not restated.
    //
    // COST, measured rather than asserted, because this rule advertises itself as
    // cheap and runs on every PR with no install and no build: +0.27 s over three
    // runs (1.06 s -> 1.33 s). It is a full source walk of five top-level trees,
    // and the `includes('open-todos:')` fast path skips the regex but not the
    // read. Worth it; worth knowing before something else is added to this loop.
    if (todoHeadings.length > 0) {
        const ANCHOR = /open-todos:\s*([^)\n*]+?)\s*(?:\)|$)/g;
        const SKIP = new Set(['node_modules', 'lib', 'dist', 'refs', 'prebuilds', '.git', 'build-dir', 'tmp']);
        const SRC = /\.(?:ts|mts|cts|js|mjs|cjs)$/;
        /** @param {string} dir @param {(f: string) => void} onFile */
        const walkSources = (dir, onFile) => {
            let entries;
            try {
                entries = readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const e of entries) {
                if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
                const full = join(dir, e.name);
                if (e.isDirectory()) walkSources(full, onFile);
                else if (SRC.test(e.name)) onFile(full);
            }
        };
        // Skipping THIS file is not an exemption, it is the same allowance
        // `tests/e2e/prebuild-change-gate` makes when it strips comment lines:
        // the prose that explains a rule has to be able to quote the shape the
        // rule rejects. The example anchor two paragraphs up tripped this check
        // on its very first run.
        const self = join(root, 'scripts', 'generate-status.mjs');
        for (const top of ['packages', 'tests', 'scripts', 'showcases', 'examples']) {
            walkSources(join(root, top), (file) => {
                if (file === self) return;
                let text;
                try {
                    text = readFileSync(file, 'utf8');
                } catch {
                    return;
                }
                if (!text.includes('open-todos:')) return;
                for (const m of text.matchAll(ANCHOR)) {
                    const anchor = m[1].trim();
                    if (!anchor) continue;
                    if (todoAnchorMatches(todoSectionList, anchor).length > 0) continue;
                    const line = text.slice(0, m.index).split('\n').length;
                    failures.push(
                        `${relative(root, file)}:${line}: deferral marker anchors to "open-todos: ${anchor}", ` +
                            'but no `### ` heading in status/open-todos.md contains that text. Either the entry was ' +
                            'renamed or deleted (re-point or remove the marker), or the marker is the only record ' +
                            'left and the entry needs writing.',
                    );
                }
            });
        }
    }

    // Upstream patch candidates: must stay the 4-column workaround table.
    const upstreamMd = read('upstream-patch-candidates.md');
    if (
        upstreamMd &&
        !/^\| *Workaround *\| *Affected Packages *\| *Current Solution *\| *Upstream Fix *\|$/m.test(upstreamMd)
    ) {
        failures.push(
            'status/upstream-patch-candidates.md must keep the `| Workaround | Affected Packages | Current Solution ' +
                '| Upstream Fix |` table header — the generator embeds it verbatim and readers rely on the shape.',
        );
    }

    // Sections: exactly the fixed set — an unknown file would silently not render.
    const sectionsDir = join(statusDir, 'sections');
    const sectionFiles = existsSync(sectionsDir)
        ? readdirSync(sectionsDir)
              .filter((f) => f.endsWith('.md'))
              .sort()
        : [];
    const sections = {};
    for (const name of SECTION_FILES) {
        if (!sectionFiles.includes(name)) {
            failures.push(`status/sections/${name} is missing (fixed section set: ${SECTION_FILES.join(', ')}).`);
            sections[name] = '';
        } else {
            sections[name] = readFileSync(join(sectionsDir, name), 'utf8').trim();
        }
    }
    for (const name of sectionFiles) {
        if (!SECTION_FILES.includes(name)) {
            failures.push(
                `status/sections/${name} is not in the fixed section set (${SECTION_FILES.join(', ')}) — the ` +
                    'generator would silently never render it. Add it to SECTION_FILES in scripts/generate-status.mjs ' +
                    '(with an anchor point) or remove the file.',
            );
        }
    }

    return {
        data: {
            packages,
            integrationMd: integrationMd.trim(),
            todosMd: todosMd.trim(),
            upstreamMd: upstreamMd.trim(),
            sections,
            adwaitaCoverage: collectAdwaitaCoverage(root),
        },
        failures,
    };
}

// ─── Rendering ──────────────────────────────────────────────────────────────

/** Escape `|` so free-text cells cannot break a Markdown table row. */
const cell = (text) =>
    String(text ?? '')
        .replaceAll('|', '\\|')
        .replaceAll(/\r?\n/g, ' ');

const strip = (name) => name.replace(/^@gjsify\//, '');

function table(header, rows) {
    const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`];
    for (const row of rows) lines.push(`| ${row.map(cell).join(' | ')} |`);
    return lines.join('\n');
}

/**
 * Render the derived per-widget coverage matrix.
 *
 * "Core" is not a claim about intent — it is whether that renderer's widget
 * reaches `@gjsify/adwaita-core`: itself, one hop through a helper of its own
 * package, or the sibling element a `CORE-VIA:` header names. An import edge is
 * the whole of what that measures, so the remainder is where ADR-0004
 * duplication would sit, not a count of measured copies — and the sentence below
 * says so, because it once said the opposite about a widget that delegates.
 *
 * Core-modelled DATA objects are listed apart from the widget table rather than
 * inside it: an `Adw.Toast` has no renderer element on either side by design, so
 * a row of two dashes would count a design decision as two missing ports.
 */
function adwaitaCoverageSection(coverage) {
    const mark = (present, core) => (present ? (core ? '✅ core' : '✅') : '—');
    const widgets = coverage.filter((w) => !w.dataObject);
    const dataObjects = coverage.filter((w) => w.dataObject);
    const rows = widgets.map((w) => [
        `\`adw-${w.name}\``,
        w.story ? '✅' : '—',
        mark(w.web, w.webCore),
        mark(w.ns, w.nsCore),
    ]);
    const both = widgets.filter((w) => w.web && w.ns);
    const shared = both.filter((w) => w.webCore && w.nsCore);
    const out = ['## Adwaita widget coverage', ''];
    out.push(
        'Derived from the tree at generation time. One row per `adw-<name>`, read from',
        "the FILE that registers it: browser `customElements.define('adw-…')` tags,",
        'NativeScript `Adw*` view classes, storybook `<name>.meta.ts`, and the actual',
        '`@gjsify/adwaita-core` import edges — so a file registering several tags gives',
        'the same core verdict to each of them. The one AUTHORED input is the',
        '`CORE-VIA:` header a widget carries when its edge runs through a sibling',
        'element, and a CI gate rejects one whose import is not there. Nothing else is',
        'maintained by hand; the table this replaced drifted twelve widgets behind the',
        'code.',
        '',
    );
    out.push(table(['Widget', 'GTK story', 'adwaita-web', 'adwaita-nativescript'], rows));
    out.push('');
    // The remainder sentence is CONDITIONAL: naming a remainder that is empty is the
    // same drift as any other stale claim — it reads as work outstanding when there
    // is none, and nobody re-reads a generated line to check.
    const unshared = both.filter((w) => !w.webCore || !w.nsCore);
    out.push(
        `**${shared.length} of ${both.length}** widgets implemented on BOTH renderers have a value-import path ` +
            'to `@gjsify/adwaita-core` from each side — direct, one hop through a helper of the same package, or ' +
            'through the sibling element a `CORE-VIA:` header names.' +
            (unshared.length > 0
                ? ` No such path is visible from at least one side for ${unshared
                      .map((w) => `\`adw-${w.name}\``)
                      .join(', ')} — an import edge is all this measures, so those are ADR 0004 duplication` +
                  ' candidates, not measured copies. A widget that does delegate to a sibling element says so' +
                  ' in its own header (`CORE-VIA:`), and a missing one lands it here.'
                : ''),
    );
    if (dataObjects.length) {
        out.push('');
        out.push(
            `Modelled in \`@gjsify/adwaita-core\` as DATA rather than as a widget, and drawn by another ` +
                `element on both renderers: ${dataObjects.map((w) => `\`adw-${w.name}\``).join(', ')}. ` +
                'Not counted above — upstream has no such widget either.',
        );
    }
    out.push('');
    return out.join('\n');
}

const testsCell = (f) => (f.tests.specFiles === 0 ? '—' : `${f.tests.specFiles} specs · ${f.tests.itSites} it()`);
const gnomeCell = (f) => (f.gnome.length === 0 ? '—' : f.gnome.join(', '));

/** Summary-table bucket for an authored status. */
const summaryBucket = (status) =>
    status === 'partial' || status === 'poc' ? 'partial' : status === 'stub' ? 'stub' : 'full';

/** The authored entry for a package (a package with no entry renders as full/no note). */
const entryLookup = (data) => (f) => data.packages[f.name] ?? { status: 'full', note: '' };

/**
 * Category classification — path-derived, split by authored status where a
 * pillar mixes kinds (APIs vs native bridges vs meta).
 *
 * @param {PackageFacts[]} facts
 * @param {(f: PackageFacts) => {status?: string}} entryOf
 */
function groupFacts(facts, entryOf) {
    const publicFacts = facts.filter((f) => !f.private);
    const inPillar = (p) => publicFacts.filter((f) => f.pillar === p);
    const adwaita = (f) => f.rel.startsWith('packages/web/adwaita');
    return {
        publicFacts,
        node: inPillar('node'),
        web: inPillar('web'),
        nodeApis: inPillar('node').filter((f) => !['native', 'meta'].includes(entryOf(f).status)),
        nodeNative: inPillar('node').filter((f) => entryOf(f).status === 'native'),
        nodeMeta: inPillar('node').filter((f) => entryOf(f).status === 'meta'),
        webApis: inPillar('web').filter((f) => !adwaita(f) && !['native', 'meta'].includes(entryOf(f).status)),
        webNative: inPillar('web').filter((f) => !adwaita(f) && entryOf(f).status === 'native'),
        webMeta: inPillar('web').filter((f) => entryOf(f).status === 'meta'),
        adwaita: inPillar('web').filter(adwaita),
        dom: inPillar('dom'),
        framework: inPillar('framework'),
        ns: inPillar('nativescript-bridge'),
        gjs: inPillar('gjs'),
        infra: inPillar('infra'),
        engines: [...inPillar('node-gi'), ...inPillar('napi')],
    };
}

/**
 * Directory-derived counts, read off the tree at generation time.
 *
 * NB these read the DISK, not git — an untracked directory under `examples/`
 * counts. That is fine for a view rendered on demand and is precisely why the
 * rendered file is not committed under a reproducibility contract (see the
 * module header).
 *
 * @param {string} root
 */
function collectTreeCounts(root) {
    const showcaseDirs = ['dom', 'gtk', 'node'].flatMap((kind) =>
        subdirs(join(root, 'showcases', kind)).map((d) => `${kind}/${d}`),
    );
    let refsCount = 0;
    try {
        refsCount = (readFileSync(join(root, '.gitmodules'), 'utf8').match(/path = refs\//g) ?? []).length;
    } catch {
        /* no .gitmodules — refs metric renders as 0 */
    }
    return {
        showcaseDirs,
        integrationDirs: subdirs(join(root, 'tests', 'integration')),
        e2eDirs: subdirs(join(root, 'tests', 'e2e')),
        exampleDirs: ['cli', 'dom', 'gtk', 'net', 'node'].flatMap((kind) => subdirs(join(root, 'examples', kind))),
        refsCount,
    };
}

/**
 * @typedef {object} SummaryCount
 * @property {string} category
 * @property {number} total
 * @property {number} full
 * @property {number} partial
 * @property {number} stub
 */

/**
 * The Summary table as NUMBERS — the structured form of what `renderStatus`
 * formats into Markdown.
 *
 * Exported because the website's coverage bars are derived from exactly these
 * counts: `website/scripts/generate-coverage.mjs` calls this instead of
 * parsing a rendered table. That is not merely tidier — the rendered file is
 * no longer committed, so there is nothing to parse; and recovering `33` from
 * a formatted `33 (80%)` cell was always a lossy round trip that existed only
 * because Markdown was the only artifact on offer.
 *
 * @param {string} root
 * @param {PackageFacts[]} facts
 * @param {ReturnType<typeof loadStatusData>['data']} data
 * @returns {SummaryCount[]}
 */
export function collectSummaryCounts(root, facts, data) {
    const entryOf = entryLookup(data);
    const groups = groupFacts(facts, entryOf);
    const { showcaseDirs, integrationDirs } = collectTreeCounts(root);

    /** @type {SummaryCount[]} */
    const counts = [];
    const summarize = (category, members) => {
        const buckets = { full: 0, partial: 0, stub: 0 };
        for (const f of members) buckets[summaryBucket(entryOf(f).status)]++;
        counts.push({ category, total: members.length, ...buckets });
    };
    summarize('Node.js APIs', groups.nodeApis);
    summarize('Node.js native bridges', groups.nodeNative);
    summarize('Node.js meta', groups.nodeMeta);
    summarize('Web APIs', groups.webApis);
    summarize('Web native bridges', groups.webNative);
    summarize('Web meta', groups.webMeta);
    summarize('Browser UI / Adwaita', groups.adwaita);
    summarize('DOM', groups.dom);
    summarize('Framework', groups.framework);
    summarize('NativeScript bridges', groups.ns);
    summarize('GJS infrastructure', groups.gjs);
    summarize('Build/Infra tools', groups.infra);
    summarize('Runtime engines', groups.engines);
    // Directory-derived rows: every showcase / suite counts as present, so the
    // Full column equals the Total and there is no partial/stub split.
    counts.push({ category: 'Showcases', total: showcaseDirs.length, full: showcaseDirs.length, partial: 0, stub: 0 });
    counts.push({
        category: 'Integration test suites',
        total: integrationDirs.length,
        full: integrationDirs.length,
        partial: 0,
        stub: 0,
    });
    return counts;
}

/**
 * Render the whole STATUS.md from derived facts + authored data.
 *
 * @param {string} root
 * @param {PackageFacts[]} facts
 * @param {ReturnType<typeof loadStatusData>['data']} data
 */
export function renderStatus(root, facts, data) {
    const rootManifest = readManifest(root) ?? {};
    const entryOf = entryLookup(data);
    const groups = groupFacts(facts, entryOf);
    const publicFacts = groups.publicFacts;
    const privateInfra = facts.filter((f) => f.pillar === 'infra' && f.private);

    const { showcaseDirs, integrationDirs, e2eDirs, exampleDirs, refsCount } = collectTreeCounts(root);

    const totalSpecs = publicFacts.reduce((n, f) => n + f.tests.specFiles, 0);
    const totalIts = publicFacts.reduce((n, f) => n + f.tests.itSites, 0);
    const browserTested = publicFacts.filter((f) => f.browserTest);

    const summaryRows = collectSummaryCounts(root, facts, data).map(({ category, total, full, partial, stub }) => {
        const pct = (n) => (total === 0 ? '—' : `${n} (${Math.round((n / total) * 100)}%)`);
        return [
            category,
            String(total),
            full === total ? String(full) : pct(full),
            partial === 0 ? '—' : pct(partial),
            stub === 0 ? '—' : pct(stub),
        ];
    });

    // Tier membership — derived from `gjsify.tier`, listed compactly.
    const tiers = new Map([
        [1, []],
        [2, []],
        [3, []],
    ]);
    for (const f of publicFacts) if (tiers.has(f.tier)) tiers.get(f.tier).push(strip(f.name));
    for (const members of tiers.values()) members.sort();

    const statusTable = (members, want, columns) => {
        const rows = [];
        for (const f of members) {
            const entry = entryOf(f);
            if (entry.status !== want) continue;
            rows.push(columns(f, entry));
        }
        return rows;
    };

    const fullCols = (f, e) => [`**${strip(f.name)}**`, gnomeCell(f), testsCell(f), e.note];
    const partialCols = (f, e) => [`**${strip(f.name)}**`, gnomeCell(f), testsCell(f), e.working ?? '—', e.missing];
    const nativeCols = (f, e) => [`**${strip(f.name)}**`, f.platforms.join(', ') || '—', gnomeCell(f), e.note];

    const pillarSection = (title, members, { partials = true } = {}) => {
        const parts = [`## ${title}`, ''];
        const full = statusTable(members, 'full', fullCols);
        if (full.length > 0) {
            parts.push(
                `### Fully implemented (${full.length})`,
                '',
                table(['Package', 'GNOME Libs', 'Tests (static)', 'Notes'], full),
                '',
            );
        }
        if (partials) {
            const partial = statusTable(members, 'partial', partialCols);
            if (partial.length > 0) {
                parts.push(
                    `### Partially implemented (${partial.length})`,
                    '',
                    table(['Package', 'GNOME Libs', 'Tests (static)', 'Working', 'Missing'], partial),
                    '',
                );
            }
            const stub = statusTable(members, 'stub', (f, e) => [`**${strip(f.name)}**`, testsCell(f), e.note]);
            if (stub.length > 0) {
                parts.push(`### Stubs (${stub.length})`, '', table(['Package', 'Tests (static)', 'Notes'], stub), '');
            }
            const poc = statusTable(members, 'poc', fullCols);
            if (poc.length > 0) {
                parts.push(
                    `### Proof-of-concept (${poc.length})`,
                    '',
                    table(['Package', 'GNOME Libs', 'Tests (static)', 'Notes'], poc),
                    '',
                );
            }
            const native = statusTable(members, 'native', nativeCols);
            if (native.length > 0) {
                parts.push(
                    `### Native bridges (${native.length})`,
                    '',
                    table(['Package', 'Platforms', 'GNOME Libs', 'Notes'], native),
                    '',
                );
            }
            const meta = statusTable(members, 'meta', (f, e) => [`**${strip(f.name)}**`, e.note]);
            if (meta.length > 0) {
                parts.push(`### Meta packages (${meta.length})`, '', table(['Package', 'Purpose'], meta), '');
            }
        }
        return parts.join('\n');
    };

    // GNOME library usage — reverse index of the per-package source scans.
    // base namespace → { label (versioned when any package pins one), pkgs }
    const gnomeUsage = new Map();
    for (const f of publicFacts) {
        for (const ns of f.gnome) {
            const base = ns.replace(/-[0-9.]+$/, '');
            if (!gnomeUsage.has(base)) gnomeUsage.set(base, { label: ns, pkgs: [] });
            const entry = gnomeUsage.get(base);
            if (entry.label === base && ns !== base) entry.label = ns;
            entry.pkgs.push(strip(f.name));
        }
    }
    const gnomeRows = [...gnomeUsage.values()]
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((entry) => [`**${entry.label}**`, [...new Set(entry.pkgs)].join(', ')]);

    const metricsRows = [
        [
            'Packages under `packages/`',
            `${publicFacts.length} published + ${facts.length - publicFacts.length} private`,
        ],
        [
            'Node.js pillar',
            `${groups.node.length} (${groups.nodeApis.length} APIs + ${groups.nodeNative.length} native bridges + ${groups.nodeMeta.length} meta)`,
        ],
        [
            'Web pillar',
            `${groups.web.length} (${groups.webApis.length} APIs + ${groups.webNative.length} native bridge + ${groups.webMeta.length} meta + ${groups.adwaita.length} Adwaita)`,
        ],
        ['DOM pillar', String(groups.dom.length)],
        ['Framework pillar', String(groups.framework.length)],
        ['NativeScript bridges', String(groups.ns.length)],
        ['GJS infrastructure', String(groups.gjs.length)],
        [
            'Build/Infra tools',
            `${groups.infra.length} published + ${privateInfra.length} private (internal, documented in AGENTS.md)`,
        ],
        ['Runtime engines (node-gi / napi)', String(groups.engines.length)],
        ['Spec files (static count, `packages/**/src`)', String(totalSpecs)],
        ['`it()` call sites (static count — not runtime totals; CI is the gate for those)', String(totalIts)],
        [
            'Packages with a browser test entry (`src/test.browser.mts`)',
            `${browserTested.length} (${browserTested.map((f) => strip(f.name)).join(', ')})`,
        ],
        [
            'Integration test suites (`tests/integration/*`)',
            `${integrationDirs.length} (${integrationDirs.join(', ')})`,
        ],
        ['E2E suites (`tests/e2e/*`)', String(e2eDirs.length)],
        ['Showcases (`showcases/*`)', `${showcaseDirs.length} (${showcaseDirs.join(', ')})`],
        ['Examples (`examples/*`)', String(exampleDirs.length)],
        ['Reference submodules (`refs/`)', String(refsCount)],
    ];

    const out = [];
    out.push('# gjsify — Project Status');
    out.push('');
    out.push('<!-- GENERATED, UNTRACKED FILE — DO NOT EDIT BY HAND, DO NOT COMMIT.');
    out.push('     Rendered by: node scripts/generate-status.mjs (npm run status:generate)');
    out.push('     Authored inputs: status/ (status.json, integration-coverage.md, open-todos.md,');
    out.push('     upstream-patch-candidates.md, sections/*.md) — those ARE tracked and are');
    out.push('     validated on every PR by audit-runtimes --check, rule `status-data`.');
    out.push('     Everything else here is DERIVED from the package manifests + the tree at the');
    out.push('     moment you ran the command, which is why this file is gitignored: a committed');
    out.push('     copy would be stale the next time anyone touched a manifest. See ADR 0016. -->');
    out.push('');
    out.push('> **This file is GENERATED and NOT COMMITTED** — re-render it whenever you want to');
    out.push('> read it (`npm run status:generate`). The status snapshot lives as data:');
    out.push('> per-package status prose in [`status/status.json`](status/status.json),');
    out.push('> integration-suite notes, open TODOs and upstream patch candidates in');
    out.push('> [`status/*.md`](status/), free-form sections in');
    out.push('> [`status/sections/`](status/sections/). Package lists, tiers, runtime slots,');
    out.push('> platform targets, GNOME-library usage and every count are derived from the repo —');
    out.push('> never typed by hand. Edit the data (or the manifests) and re-render. This remains a');
    out.push('> CURRENT SNAPSHOT, not a changelog: per-change narrative belongs in commit messages');
    out.push('> + CHANGELOG.md.');
    out.push('');
    out.push('## Summary');
    out.push('');
    out.push(
        `gjsify implements Node.js, Web Standard, and DOM APIs for GJS (GNOME JavaScript / SpiderMonkey 140). ` +
            `Release train version: **v${rootManifest.version ?? '?'}** (every \`@gjsify/*\` package publishes at one version, ADR 0008).`,
    );
    out.push('');
    out.push(table(['Category', 'Total', 'Full', 'Partial', 'Stub'], summaryRows));
    out.push('');
    // The two directory-derived rows would otherwise read as a coverage claim.
    // `Full` means "implemented" for every row EXCEPT these, where it is
    // `Total` by construction (see `summarize`'s callers) — a suite counts as
    // present because its directory exists, which says nothing about whether
    // anything runs it. Saying so here is cheaper than a reader inferring
    // "35 / 35 integration suites" as "35 suites pass".
    out.push(
        '> **Showcases** and **Integration test suites** are counted from directories: `Full` equals `Total` ' +
            'by construction and asserts only that the directory is there. Which of them any CI event actually ' +
            'runs is a separate question — see the Integration Test Coverage section and `status/open-todos.md`.',
    );
    out.push('');
    if (data.sections['summary-notes.md']) out.push(data.sections['summary-notes.md'], '');
    out.push('---', '');
    out.push('## Package Tiers');
    out.push('');
    out.push(
        'Every published package declares its stability contract in `package.json#gjsify.tier` — the source of ' +
            'truth, verified by `scripts/audit-runtimes.mjs --check` (tier presence + dependency direction). ' +
            'See [ADR 0003](docs/adr/0003-package-tiering.md) + [ADR 0005](docs/adr/0005-node-gi-scope.md). ' +
            'Membership below is derived from the manifests:',
    );
    out.push('');
    out.push(`- **Tier 1 — core (${tiers.get(1).length}):** stability promise. ${tiers.get(1).join(', ')}`);
    out.push(`- **Tier 2 — product (${tiers.get(2).length}):** best effort. ${tiers.get(2).join(', ')}`);
    out.push(
        `- **Tier 3 — experimental (${tiers.get(3).length}):** no promise; new axes start here. ${tiers.get(3).join(', ')}`,
    );
    out.push('', '---', '');

    out.push(pillarSection('Node.js Packages (`packages/node/`)', groups.node));
    out.push('---', '');
    out.push(
        pillarSection('Web API Packages (`packages/web/`, excluding Adwaita)', [
            ...groups.webApis,
            ...groups.webNative,
            ...groups.webMeta,
        ]),
    );
    if (data.sections['webrtc-status.md']) out.push(data.sections['webrtc-status.md'], '');
    out.push('---', '');
    out.push(pillarSection('Browser UI / Adwaita Packages (`packages/web/adwaita*`)', groups.adwaita));
    out.push(adwaitaCoverageSection(data.adwaitaCoverage));
    if (data.sections['adwaita-web-roadmap.md']) out.push(data.sections['adwaita-web-roadmap.md'], '');
    out.push('---', '');
    out.push(pillarSection('DOM Packages (`packages/dom/`)', groups.dom));
    out.push('---', '');
    out.push(pillarSection('Framework Packages (`packages/framework/`)', groups.framework));
    if (data.sections['webgl-known-issues.md']) out.push(data.sections['webgl-known-issues.md'], '');
    out.push('---', '');
    out.push(pillarSection('NativeScript Bridge Packages (`packages/nativescript-bridge/`)', groups.ns));
    out.push('---', '');
    out.push(pillarSection('GJS Infrastructure (`packages/gjs/`)', groups.gjs));
    out.push('---', '');
    out.push(pillarSection('Build Infrastructure (`packages/infra/`)', groups.infra));
    out.push('---', '');
    out.push(pillarSection('Runtime Engines (`packages/node-gi/`, `packages/napi/`)', groups.engines));
    out.push('---', '');
    out.push('## GNOME Library Usage');
    out.push('');
    out.push("Derived from `gi://` imports in each package's sources (namespace + version where pinned):");
    out.push('');
    out.push(table(['GNOME Namespace', 'Used In'], gnomeRows));
    out.push('', '---', '');
    out.push('## Metrics');
    out.push('');
    out.push('All derived at generation time — none of these numbers is maintained by hand.');
    out.push('');
    out.push(table(['Metric', 'Value'], metricsRows));
    out.push('', '---', '');
    if (data.sections['priorities.md']) out.push(data.sections['priorities.md'], '', '---', '');
    out.push('## Integration Test Coverage');
    out.push('');
    out.push(
        `\`tests/integration/\` validates \`@gjsify/*\` implementations by running curated upstream tests from ` +
            // `gjsify foreach test:integration` stood here and runs NOTHING: no suite declares
            // that script, and foreach only hard-fails a zero-match `--include` pattern, not a
            // zero-match script name. It exits 0. The summary section rendered above this one
            // warns against exactly this spelling, so the generated file carried the warning and
            // the trap in one document.
            `popular npm packages — ${integrationDirs.length} suites (run them all with ` +
            `\`gjsify run test:integration\` from the repo root; CI gates the measured-green subset). ` +
            'Suite notes are authored in [`status/integration-coverage.md`](status/integration-coverage.md); ' +
            'headings are validated against the suite directories.',
    );
    out.push('');
    out.push(data.integrationMd, '');
    out.push('---', '');
    out.push('## Open TODOs');
    out.push('');
    out.push(
        'Tracked follow-up work that has been deliberately deferred. Every "out of scope" / "follow-up" note from ' +
            'a PR must end up here (authored in [`status/open-todos.md`](status/open-todos.md)). A resolved TODO is ' +
            'DELETED — its record is the commit + CHANGELOG that closed it; the `status-data` check rejects ' +
            'struck-through or "Completed" headings.',
    );
    out.push('');
    out.push(data.todosMd, '');
    out.push('---', '');
    out.push('## Upstream GJS Patch Candidates');
    out.push('');
    out.push(data.upstreamMd, '');
    out.push('## Changelog');
    out.push('');
    out.push('All dated entries live in [CHANGELOG.md](CHANGELOG.md). Do not duplicate them here.');
    out.push('');
    return out.join('\n');
}

// ─── Public entry points ────────────────────────────────────────────────────

/**
 * Validate + render. Returns `{ content, failures }`; `content` is `null` when
 * validation failed (rendering from invalid data would mask the failure).
 *
 * @param {string} root
 */
export function generateStatus(root) {
    const facts = collectPackageFacts(root);
    const { data, failures } = loadStatusData(root, facts);
    if (failures.length > 0) return { content: null, failures };
    return { content: renderStatus(root, facts, data), failures: [] };
}

/**
 * Validate + return the Summary counts as numbers — the machine-readable entry
 * point (`website/scripts/generate-coverage.mjs`). Throws on invalid authored
 * data rather than returning counts computed from data the `status-data` rule
 * would reject; a consumer must not silently bake half-valid numbers.
 *
 * @param {string} root
 * @returns {SummaryCount[]}
 */
export function statusSummary(root) {
    const facts = collectPackageFacts(root);
    const { data, failures } = loadStatusData(root, facts);
    if (failures.length > 0) {
        throw new Error(
            `status/ authored data is invalid, refusing to derive summary counts from it:\n  - ${failures.join('\n  - ')}`,
        );
    }
    return collectSummaryCounts(root, facts, data);
}

const IS_ENTRY = Boolean(process.argv[1]) && resolve(process.argv[1]).endsWith('generate-status.mjs');

if (IS_ENTRY) {
    const root = resolve(fileURLToPath(import.meta.url), '..', '..');
    const { content, failures } = generateStatus(root);
    if (failures.length > 0) {
        console.error('generate-status: authored data is invalid:\n');
        for (const failure of failures) console.error(`  ✗ ${failure}`);
        process.exit(1);
    }
    // STATUS.md is gitignored — writing it is always safe, and "already up to
    // date" is a statement about a scratch file, never a CI-relevant fact.
    // There is deliberately NO `--check` mode: a freshness comparison only has
    // meaning for a committed artifact, and reintroducing one would re-import
    // the parallel-PR serialisation this file's header describes.
    const statusPath = join(root, 'STATUS.md');
    const current = existsSync(statusPath) ? readFileSync(statusPath, 'utf8') : '';
    if (current === content) {
        console.log('generate-status: STATUS.md already up to date.');
    } else {
        writeFileSync(statusPath, content, 'utf8');
        console.log(`generate-status: wrote STATUS.md (${content.length} bytes, gitignored).`);
    }
}

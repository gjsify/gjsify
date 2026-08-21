/**
 * Rule `stylesheet-font-families` — a shipped stylesheet may not head a font stack
 * with a family the tarball does not carry, unless the reason is written down.
 *
 * THE DEFECT
 *
 * `@gjsify/adwaita-web`'s `_variables.scss` declared
 * `--monospace-font-family: 'Adwaita Mono', …` above a comment saying "Adwaita Mono
 * heads it because `@gjsify/adwaita-fonts` ships it". That package ships two Adwaita
 * SANS TTFs and no mono face at all, so every `.monospace` label rendered in whatever
 * the generic tail resolved to — and on the workstation where it was written that was
 * the system `adwaita-mono-fonts`, so it looked exactly right. The NativeScript theme
 * carrying the SAME stack already said the opposite in prose
 * (`nativescript-bridge/adwaita/src/theme/adwaita.css`), which is the shape of every
 * claim nothing checks: two copies, one drifted, and the drifted one is the one an
 * agent reads.
 *
 * The Sans half was worse, because it was invisible from the CSS: the stylesheet's
 * `--font-family` heads with `'Adwaita Sans'` and the entry carried
 * `import '@gjsify/adwaita-fonts';` — which under css-as-string is
 * `export default "<css>"`, a side-effect import of a module with no side effect,
 * tree-shaken to a MEASURED 0-byte bundle, exit 0.
 *
 * WHAT IT CHECKS
 *
 * For every stylesheet a PUBLISHED package actually ships (`.css`/`.scss` covered by
 * `package.json#files`), the FIRST named family of every `font-family` declaration —
 * including the `--*-font-family` custom properties that feed them — must resolve to
 * an `@font-face` rule in ONE OF THAT PACKAGE'S OWN shipped stylesheets, whose `src:`
 * targets are `data:` URIs, `local()`, or files that exist and are themselves shipped.
 * Otherwise the pair needs an entry in `status/stylesheet-font-families.json`.
 *
 * OWN stylesheets, deliberately, and the first draft got this wrong in the most
 * expensive direction: it accepted a face from any workspace package on the
 * dependency closure, which passed `@gjsify/adwaita-web`'s 'Adwaita Sans' because it
 * DEPENDS on `@gjsify/adwaita-fonts`. Depending on a font package puts nothing in
 * your cascade — the consumer has to import it, and the whole point of this PR is that
 * the one import doing so registered nothing. A rule that green-lights the defect it
 * was written for is worse than no rule. Cross-package `@import` chains are not
 * followed either: a stylesheet that genuinely pulls a face in from a dependency is
 * over-reported here and lands in the ledger with that as its reason, which is the
 * safe direction to be wrong in.
 *
 * THE LEDGER IS THE POINT, and it is the same shape as
 * `status/nativescript-theme-classes.json` for the same reason: naming a font the
 * package does not carry is often RIGHT — a system-installed face is a legitimate
 * progressive enhancement, and inlining an unsubsetted desktop TTF as base64 is
 * 594 KB gzip against a 26 KB stylesheet. What is never right is nobody knowing which
 * of the two it is. An entry is a decision with a reason attached; its absence is an
 * accident. Entries are self-retiring: one that no longer describes a live claim
 * FAILS, so a fixed stack cannot leave a stale excuse behind.
 *
 * WHAT IT DOES NOT CHECK
 *
 *   - Whether the face survives the BUNDLER. A `@font-face` in a `.css` file is real
 *     for a CSS pipeline and vanishes under `--app browser`; that half is
 *     `packages/web/adwaita-web/src/adw-fonts.spec.ts`, which asserts against
 *     `document.fonts` in a real Firefox.
 *   - Anything in a `private: true` package. `examples/*` legitimately name
 *     `-apple-system` and `HelveticaNeue-Light` and ship no fonts; a rule that
 *     demanded a ledger line for each would be routed around within a week.
 *   - A stylesheet outside `files`. `showcases/node/express-webserver` names
 *     'Adwaita Sans' in `src/public/style.css` while shipping only `dist` — not a
 *     claim about a tarball.
 *   - A generated stylesheet on an UNBUILT tree. `adwaita-web`'s
 *     `dist/adwaita-web.css` is absent in a fresh checkout; its `scss/` sources carry
 *     the same declarations and are committed, so the claim is inspected either way.
 *     The count of stylesheets inspected is printed so a run that saw none says so.
 *
 * REPO-SCOPED because it reads a ledger under `status/` and names this repository's
 * own packages in its diagnostics — neither exists in a consumer's tree.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { defineRule, toPosixPath } from '../../../packages/infra/manifest-conformance/lib/index.mjs';

/** Where the reasons live. Keyed `<package rel>: <family>`. */
export const LEDGER_PATH = 'status/stylesheet-font-families.json';

/** Never descend: build inputs of other tools, and vendored trees. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'refs', 'fixtures', 'test-results', 'playwright-report']);

/**
 * CSS generic families and the CSS-wide keywords. A stack that STARTS with one of
 * these promises nothing about a shipped file — `font-family: monospace` asks the
 * host for whatever it calls monospace, which is the correct way to ask.
 */
const GENERIC_FAMILIES = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
    'math',
    'emoji',
    'fangsong',
    'inherit',
    'initial',
    'unset',
    'revert',
    'revert-layer',
]);

/**
 * Comments, stripped the way each SYNTAX defines them.
 *
 * `//` is a line comment in Sass and NOT in CSS, and the difference is load-bearing
 * rather than pedantic: a CSS `src:` can hold a base64 `data:` URI, whose alphabet
 * includes `/`, so a `//` sequence inside one is ordinary payload. Stripping Sass
 * comments out of CSS would delete the rest of that rule and report the face as
 * missing — the exact false accusation this rule exists to avoid.
 */
function stripComments(source, isSass) {
    const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
    return isSass ? withoutBlocks.replace(/(^|[\s;{}])\/\/[^\n]*/g, '$1') : withoutBlocks;
}

/** `'Adwaita Sans'` / `"Adwaita Sans"` / `Adwaita Sans` → `Adwaita Sans`. */
function unquote(value) {
    return value
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .trim();
}

/**
 * One `package.json#files` entry, as a predicate over a package-relative POSIX path.
 * `lib` covers `lib/**`; `src/theme/adwaita.css` covers itself; `*.css` matches a
 * BASENAME at any depth, which is npm-packlist's gitignore-style reading and the
 * inclusive one — a rule that under-collects would silently stop inspecting a
 * stylesheet rather than fail.
 */
function filesEntryMatcher(entry) {
    const pattern = String(entry).replace(/^\.\//, '').replace(/\/+$/, '');
    if (!pattern.includes('*')) {
        return (rel) => rel === pattern || rel.startsWith(`${pattern}/`);
    }
    const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    const re = new RegExp(`^${body}$`);
    return (rel) => re.test(rel) || re.test(rel.slice(rel.lastIndexOf('/') + 1));
}

/** Is this package-relative path inside the tarball? No `files` ⇒ npm's default set. */
function shipsPath(manifest, rel) {
    const files = manifest.files;
    if (!Array.isArray(files) || files.length === 0) return true;
    return files.some((entry) => filesEntryMatcher(entry)(rel));
}

/** Every `.css`/`.scss` under `dir`, absolute. */
function findStylesheets(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) findStylesheets(path, out);
        else if (/\.(css|scss)$/i.test(entry.name)) out.push(path);
    }
    return out;
}

/** The `url(…)` targets of a `src:` value, unquoted, in source order. */
function srcUrls(value) {
    return [...value.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2].trim());
}

/**
 * Parse one stylesheet into `{ faces, claims }`.
 *
 * `faces` are the `@font-face` rules; `claims` are the first named family of every
 * `font-family` / `--*font-family` declaration OUTSIDE one. A `var()` value is not a
 * claim — it defers to whatever the referenced property holds, which is checked where
 * that property is DECLARED, so checking it twice would report one defect as two.
 */
function parseStylesheet(path, source) {
    const text = stripComments(source, /\.scss$/i.test(path));
    const faces = [];
    for (const match of text.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
        const body = match[1];
        const family = /(?:^|[\s;{])font-family\s*:\s*([^;}]+)/.exec(body);
        const src = /(?:^|[\s;{])src\s*:\s*([^;}]+)/.exec(body);
        if (!family) continue;
        faces.push({ family: unquote(family[1]), urls: src ? srcUrls(src[1]) : [] });
    }

    const claims = [];
    const outsideFaces = text.replace(/@font-face\s*\{[^}]*\}/g, ' ');
    for (const match of outsideFaces.matchAll(/(?:^|[\s;{])(--[\w-]*font-family|font-family)\s*:\s*([^;}]+)/g)) {
        const value = match[2].trim();
        if (value.startsWith('var(')) continue;
        const first = unquote(value.split(',')[0]);
        if (first.length === 0 || GENERIC_FAMILIES.has(first.toLowerCase())) continue;
        claims.push({ property: match[1], family: first });
    }
    return { faces, claims };
}

/** Read the ledger, or `{}` when it is absent (the rule still reports every claim). */
function readLedger(root) {
    const path = join(root, LEDGER_PATH);
    if (!existsSync(path)) return {};
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return parsed?.reviewed && typeof parsed.reviewed === 'object' ? parsed.reviewed : {};
    } catch {
        return {};
    }
}

/**
 * @param {import('../../../packages/infra/manifest-conformance/lib/context.mjs').ConformanceContext} ctx
 */
export function auditStylesheetFontFamilies(ctx) {
    const failures = [];
    const ledger = readLedger(ctx.root);
    const usedLedgerKeys = new Set();

    /** @type {Map<string, {pkg: any, sheets: {rel: string, faces: any[], claims: any[]}[]}>} */
    const inspected = new Map();
    let sheetCount = 0;

    for (const pkg of ctx.packages) {
        if (pkg.private) continue;
        const sheets = [];
        for (const absolute of findStylesheets(pkg.dir)) {
            const rel = toPosixPath(absolute.slice(pkg.dir.length + 1));
            if (!shipsPath(pkg.manifest, rel)) continue;
            const parsed = parseStylesheet(absolute, readFileSync(absolute, 'utf8'));
            if (parsed.faces.length === 0 && parsed.claims.length === 0) continue;
            sheets.push({ rel, absolute, ...parsed });
            sheetCount++;
        }
        if (sheets.length > 0) inspected.set(pkg.manifest.name, { pkg, sheets });
    }

    /** Families a package CARRIES: a face whose every `src:` target is really there. */
    const carried = new Map();
    for (const [name, { pkg, sheets }] of inspected) {
        const families = new Map();
        for (const sheet of sheets) {
            for (const face of sheet.faces) {
                const missing = face.urls.filter((url) => {
                    if (/^(data|https?|file):/i.test(url) || url.startsWith('local(')) return false;
                    const target = resolve(dirname(sheet.absolute), url.split(/[?#]/)[0]);
                    if (!existsSync(target) || !statSync(target).isFile()) return true;
                    return !shipsPath(pkg.manifest, toPosixPath(target.slice(pkg.dir.length + 1)));
                });
                if (missing.length > 0) {
                    failures.push(
                        `${pkg.rel}/${sheet.rel}: \`@font-face\` for "${face.family}" has \`src:\` target(s) the ` +
                            `package does not ship — ${missing.join(', ')}. A rule whose payload is absent from the ` +
                            `tarball parses and then 404s, which looks identical to a working font on a host that has ` +
                            `the family installed. Add the file to \`package.json#files\`, or inline it as a \`data:\` URI.`,
                    );
                    continue;
                }
                families.set(face.family, `${pkg.rel}/${sheet.rel}`);
            }
        }
        carried.set(name, families);
    }

    let claimCount = 0;
    for (const [name, { pkg, sheets }] of inspected) {
        const own = carried.get(name);
        /** @type {Map<string, Set<string>>} family → the shipped stylesheets claiming it */
        const claimsByFamily = new Map();
        for (const sheet of sheets) {
            for (const claim of sheet.claims) {
                // A SET: `_variables.scss` declares the same property twice (the
                // light-theme mixin and its `:root` include), and one declaration
                // reported three times reads as three defects.
                const where = claimsByFamily.get(claim.family) ?? new Set();
                where.add(`${pkg.rel}/${sheet.rel} (${claim.property})`);
                claimsByFamily.set(claim.family, where);
            }
        }

        for (const [family, where] of claimsByFamily) {
            claimCount++;
            const provider = own?.has(family) ? own : undefined;
            const key = `${pkg.rel}: ${family}`;
            if (provider) {
                if (Object.hasOwn(ledger, key)) {
                    usedLedgerKeys.add(key);
                    failures.push(
                        `${LEDGER_PATH} still carries "${key}", but the family now HAS a shipped \`@font-face\` ` +
                            `(${provider.get(family)}). Delete the entry — a reason that no longer describes anything ` +
                            `is the thing the next reader trusts.`,
                    );
                }
                continue;
            }
            if (Object.hasOwn(ledger, key)) {
                usedLedgerKeys.add(key);
                continue;
            }
            failures.push(
                `${[...where].join(', ')} heads a font stack with "${family}", and ${pkg.rel} ships no ` +
                    `\`@font-face\` for it. That is not automatically wrong — a ` +
                    `system-installed face is a legitimate progressive enhancement — but it must be a DECISION: add ` +
                    `"${key}" to ${LEDGER_PATH} with the reason, or ship the face. Do NOT verify this by looking at ` +
                    `the rendering: a GNOME host resolves 'Adwaita Sans'/'Adwaita Mono' from fontconfig and every ` +
                    `screenshot looks right over a tree that ships neither.`,
            );
        }
    }

    for (const key of Object.keys(ledger)) {
        if (usedLedgerKeys.has(key)) continue;
        failures.push(
            `${LEDGER_PATH} carries "${key}", which matches no font-family claim in any shipped stylesheet. Either ` +
                `the package/family was renamed or the declaration is gone; delete the entry or fix its key.`,
        );
    }

    return { failures, stats: { packages: inspected.size, stylesheets: sheetCount, families: claimCount } };
}

export const stylesheetFontFamiliesRule = defineRule({
    id: 'stylesheet-font-families',
    scope: 'repo',
    // Governs no `gjsify.*` key: its subject is `files` + the stylesheets it ships.
    // Declared explicitly so the registry's "say what you govern" contract is met.
    fields: [],
    description: 'a shipped stylesheet only heads a font stack with a family it carries, or a listed reason',
    run(ctx) {
        const { failures, stats } = auditStylesheetFontFamilies(ctx);
        return {
            failures,
            stats,
            summary:
                `stylesheet-font-families: ${stats.stylesheets} shipped stylesheet(s) in ${stats.packages} ` +
                `package(s), ${stats.families} first-named family claim(s) checked`,
        };
    },
});

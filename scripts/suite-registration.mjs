// Which `*.spec.ts` a package REACHES, and which it actually RUNS — read once, for
// every gate that needs either fact.
//
// THE INCIDENT
//
// `check-adwaita-conformance-drivers.mjs` called a conformance vector table "driven"
// when any `*.spec.ts` under a renderer named it outside a comment. Naming is not
// running, and the gap was measured on this tree (#1365): delete the single line
// `AdwCarouselNsTest,` from the `run({…})` in
// `packages/nativescript-bridge/adwaita/src/test.mts`, leave its import in place, and
// `carousel.spec.ts` executes nowhere — while the driver gate, this repo's node
// registration gate and its browser registration gate ALL stayed green, still counting
// `CAROUSEL_NAVIGATE_VECTORS`, `CAROUSEL_REVEAL_VECTORS` and
// `CAROUSEL_PROPERTY_DEFAULT_VECTORS` as renderer-driven. `runTests` in
// `packages/gjs/unit/src/index.ts` iterates the object `run()` is handed and calls
// nothing else, so a binding absent from that object is never invoked.
//
// TWO NOTIONS, AND WHY THEY LIVE IN ONE FILE
//
//   reachable — some `src/test*.{mts,ts}` entry imports it, directly or through
//               another spec. A spec no entry reaches cannot run at all. The closure
//               over spec-to-spec imports is what keeps helper specs
//               (`packages/node/fs/src/capabilities.spec.ts`, shared by six siblings)
//               from reading as orphans.
//   live      — an entry binds its suite export AND hands that binding to `run({…})`,
//               or calls it outright. Reachable is necessary and NOT sufficient: an
//               imported-but-unregistered spec is reachable and runs nothing, which is
//               exactly the shape above.
//
// Deriving the weaker one where the stronger was meant is how the hole opened, and two
// gates deriving the same fact two ways is how they drift apart — so both notions come
// from this reader and each caller says which it is asking for.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { TS_SOURCE_EXTENSIONS } from '../packages/infra/manifest-conformance/lib/source-extensions.mjs';

/** Directories that never hold first-party sources. */
export const SKIP = new Set(['node_modules', 'dist', 'lib', '.git', 'refs', 'tmp']);

/**
 * Files below `dir` whose basename `match` accepts, at any depth.
 *
 * Walking rather than globbing: a glob is blind to the first spec that lands in a
 * subdirectory, and going blind is the failure every caller of this file removes.
 */
export function walk(dir, match, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, match, out);
        else if (match(entry.name)) out.push(full);
    }
    return out;
}

/** Every directory holding a `package.json`, without descending into one. */
export function packageDirs(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name) || !entry.isDirectory()) continue;
        const full = join(dir, entry.name);
        if (existsSync(join(full, 'package.json'))) out.push(full);
        else packageDirs(full, out);
    }
    return out;
}

/** `foo.spec.ts`, `foo.spec.tsx`, … — the spec-file half of the vocabulary. */
export const SPEC_RE = new RegExp(`\\.spec\\.(${TS_SOURCE_EXTENSIONS.join('|')})$`);
const ENTRY_EXT_RE = new RegExp(`\\.(${TS_SOURCE_EXTENSIONS.join('|')})$`);

/** A `*.spec.*` file, at any of the TypeScript extensions. @param {string} name */
export const isSpecFile = (name) => SPEC_RE.test(name);

/**
 * `src/test.mts`, `src/test.browser.mts`, `src/test.node-gi.mts` — and `src/test.ts`,
 * which `packages/node/url` and `packages/node/util` use for the same job. Both
 * extensions, or those two packages' node specs read as orphans while they run on
 * every PR.
 *
 * The extension set is the shared vocabulary rather than the `.mts`/`.ts` pair written
 * here before: a spec or an entry that renders JSX is a `.tsx` file, and a walker that
 * does not open it reports the same green as one that found nothing wrong.
 *
 * @param {string} name
 */
export function isTestEntry(name) {
    if (!name.startsWith('test') || isSpecFile(name)) return false;
    return ENTRY_EXT_RE.test(name);
}

/**
 * Comments out, string literals through untouched.
 *
 * Every scan here is LEXICAL, and a comment is the one place a suite name can appear
 * while registering nothing. Both directions were measured on a copy of the real
 * adwaita-web tree: a block-commented `{ AdwSwitchTest }` left as the last element of
 * the object passed GREEN over a suite that ran nowhere, a block comment anywhere
 * inside the object swallowed the following key and falsely accused it, and a line
 * `// e.g. run({ … })` above the real call captured the `run(` search outright and
 * reported every spec as unregistered.
 *
 * A regex pair would be shorter and WRONG: `packages/node/url/src/test.browser.mts` is
 * built out of `'http://example.com/…'` literals, and a `//`-to-end-of-line strip eats
 * the rest of every line one of them sits on — measured, it deletes real code from that
 * entry today. So this walks the source and skips quoted runs, because a check that
 * reads the file differently from the engine that runs it is the bug, not the guard.
 */
export function stripComments(source) {
    let out = '';
    let i = 0;
    while (i < source.length) {
        const c = source[i];
        if (c === '/' && source[i + 1] === '/') {
            while (i < source.length && source[i] !== '\n') i++;
        } else if (c === '/' && source[i + 1] === '*') {
            const end = source.indexOf('*/', i + 2);
            i = end === -1 ? source.length : end + 2;
        } else if (c === "'" || c === '"' || c === '`') {
            const start = i++;
            while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
            out += source.slice(start, ++i);
        } else {
            out += c;
            i++;
        }
    }
    return out;
}

/**
 * A relative specifier as the file on disk.
 *
 * FOUR spellings are in use and all four appear in test entries: `'./x.spec.js'` (TS's
 * ESM form, most of the repo), `'./x.spec'` (extensionless,
 * `packages/web/dom-events`), `'./x.spec.ts'` (verbatim, `packages/infra/tsc`) and
 * `'./test.mjs'` (an entry re-exporting the shared entry). Handling only the first two
 * reported `packages/infra/tsc`'s one spec as an orphan while it ran on every PR — a
 * false violation is how a checker teaches people to ignore it.
 */
export function resolveToSource(specifier, fromDir = null) {
    if (ENTRY_EXT_RE.test(specifier)) return specifier;
    const base = specifier.replace(/\.m?js$/, '');
    const preferred = specifier.endsWith('.mjs') ? `${base}.mts` : `${base}.ts`;
    // The two-line mapping this replaced could only ever name `.ts` and `.mts`, so a
    // `foo.spec.tsx` imported as `./foo.spec.js` resolved to a path that does not exist
    // and the spec read as an orphan — loud rather than silent, and still wrong. `fromDir`
    // is how a caller lets the disk decide; without it the historical guess stands, which
    // is what keeps this a pure string function for the callers that pass no directory.
    if (fromDir === null) return preferred;
    if (existsSync(join(fromDir, preferred))) return preferred;
    for (const ext of TS_SOURCE_EXTENSIONS) {
        const candidate = `${base}.${ext}`;
        if (existsSync(join(fromDir, candidate))) return candidate;
    }
    return preferred;
}

/**
 * Every relative import in `source`, as `{ target, bindings }`.
 *
 * `bindings` are the LOCAL names the module gets — a default import, the aliased or
 * bare members of a brace clause, a namespace binding — because "is this suite
 * registered" is asked of the local name, not of the exported one. A side-effect
 * import (`import './x.spec.js'`) binds nothing and still reaches the file, so it
 * yields an empty binding list rather than being dropped.
 *
 * Only RELATIVE specifiers: a spec reached through a package name is a published entry
 * point, not this package's own test file, and resolving those would need the module
 * graph rather than a regex.
 */
export function relativeImports(file, source) {
    const found = [];
    const pattern =
        /(?:^|[\s;}])(?:import|export)\s+([^'"();]*?)\s*from\s*['"](\.[^'"]+)['"]|(?:^|[\s;}])import\s*['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]/g;
    for (const match of source.matchAll(pattern)) {
        const clause = match[1];
        const specifier = match[2] ?? match[3] ?? match[4];
        found.push({
            target: resolve(dirname(file), resolveToSource(specifier, dirname(file))),
            specifier,
            bindings: clause === undefined ? [] : bindingsIn(clause),
        });
    }
    return found;
}

/** The local names an import clause introduces. A type-only name binds no value. */
function bindingsIn(clause) {
    const bindings = [];
    const text = clause.trim();
    // `import type { AdwLengthUnit } from './x.js'` borrows a name for a field and runs
    // nothing — the same distinction the driver gate's MODULE arm already turns on.
    if (/^type\b/.test(text)) return bindings;
    const brace = text.indexOf('{');
    const head = (brace === -1 ? text : text.slice(0, brace)).replace(/,\s*$/, '').trim();
    if (head.startsWith('*')) bindings.push(head.replace(/^\*\s*as\s*/, ''));
    else if (head) bindings.push(head);
    if (brace !== -1) {
        for (const member of text.slice(brace + 1, text.indexOf('}', brace)).split(',')) {
            const part = member.trim();
            if (part === '' || part.startsWith('type ')) continue;
            bindings.push(/\bas\s+([A-Za-z_$][\w$]*)$/.exec(part)?.[1] ?? part);
        }
    }
    return bindings.filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

/** The body of the first `run({…})` in `source`, or `null` when there is none. */
function runObjectBody(source) {
    const call = /\brun\s*\(\s*\{/.exec(source);
    if (call === null) return null;
    const open = source.indexOf('{', call.index);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
    }
    return null;
}

/** Split an object body on its own top-level commas — a nested literal is one part. */
function topLevelParts(body) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if ('{(['.includes(c)) depth++;
        else if ('})]'.includes(c)) depth--;
        else if (c === ',' && depth === 0) {
            parts.push(body.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(body.slice(start));
    return parts;
}

/** The offset of a property's own `:`, or -1 for shorthand. */
function separatorIndex(part) {
    let depth = 0;
    for (let i = 0; i < part.length; i++) {
        const c = part[i];
        if ('{(['.includes(c)) depth++;
        else if ('})]'.includes(c)) depth--;
        else if (c === ':' && depth === 0) return i;
    }
    return -1;
}

/**
 * The identifiers `source` registers as suites: the values of a `run({…})` property at
 * any depth (`runTests` recurses into a nested object, so a suite grouped inside one is
 * registered just as much as a top-level entry), plus anything the entry CALLS —
 * `packages/web/webrtc/src/test.mts` awaits its four spec defaults directly instead of
 * handing them to `run`, and that runs them.
 *
 * VALUE position, not key: `run({ Promise: promiseSuite })` registers `promiseSuite`,
 * and it is the local binding a caller compares against. An inline `key: async () => {…}`
 * names no spec file, so it raises `properties` and adds no symbol.
 */
export function registeredSymbols(source) {
    const registered = new Set();
    const body = runObjectBody(source);
    const properties = body === null ? 0 : collectSuiteIdentifiers(body, registered);
    const called = new Set();
    for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) called.add(match[1]);
    // `registered` and `called` stay apart because one caller needs them apart:
    // `check-browser-test-registration.mjs` fails an entry whose `run({})` registers NOTHING,
    // and `run` is itself a called identifier — folded together, that arm could never fire.
    // `properties` counts what the object registers; `registered` holds only what it
    // registers BY NAME. They differ on the method shorthand 23 browser entries use —
    // `run({ async DomExceptionTest() {…} })` registers a suite and names no module — so
    // "does this object register anything" has to read the count, not the set.
    return { registered, called, registers: body !== null, properties };
}

/** Adds the by-name registrations to `symbols`; returns how many properties there were. */
function collectSuiteIdentifiers(body, symbols) {
    let properties = 0;
    for (const raw of topLevelParts(body)) {
        const part = raw.trim();
        if (part === '') continue;
        const separator = separatorIndex(part);
        if (separator === -1) {
            properties += 1;
            const shorthand = /^([A-Za-z_$][\w$]*)$/.exec(part);
            if (shorthand) symbols.add(shorthand[1]);
            continue;
        }
        const value = part.slice(separator + 1).trim();
        const identifier = /^([A-Za-z_$][\w$]*)$/.exec(value);
        if (identifier) {
            properties += 1;
            symbols.add(identifier[1]);
        } else if (value.startsWith('{')) {
            properties += collectSuiteIdentifiers(value.slice(1, value.lastIndexOf('}')), symbols);
        } else {
            properties += 1;
        }
    }
    return properties;
}

/**
 * What a package's test entries reach and what they run.
 *
 * `opaque` names entries whose registration could not be read at all — no `run({…})`,
 * no delegation to a sibling entry, no spec called by hand. `live` is then INCOMPLETE
 * for that package, so a caller that gates on `live` must fail on a non-empty `opaque`
 * rather than report every spec dead: an unreadable entry is a limit of this reader,
 * and a limit that reports itself as a finding about someone else's code is the
 * expensive kind of wrong.
 */
export function readSuiteRegistration(pkgDir) {
    const src = join(pkgDir, 'src');
    const empty = { src, entries: [], specs: [], reachable: new Set(), live: new Set(), opaque: [] };
    if (!existsSync(src) || !statSync(src).isDirectory()) return empty;
    const entries = readdirSync(src)
        .filter(isTestEntry)
        .map((name) => join(src, name));
    if (entries.length === 0) return empty;
    const specs = walk(src, isSpecFile);
    if (specs.length === 0) return { ...empty, entries };

    const isSpec = new Set(specs);
    const isEntry = new Set(entries);
    const sources = new Map([...entries, ...specs].map((file) => [file, stripComments(readFileSync(file, 'utf8'))]));

    const reachable = new Set();
    const live = new Set();
    const opaque = [];
    const queue = [];

    for (const entry of entries) {
        const source = sources.get(entry);
        const { registered, called, registers } = registeredSymbols(source);
        const imports = relativeImports(entry, source);
        let bound = false;
        for (const { target, bindings } of imports) {
            if (!isSpec.has(target)) continue;
            if (!reachable.has(target)) {
                reachable.add(target);
                queue.push(target);
            }
            if (bindings.some((name) => registered.has(name) || called.has(name))) {
                bound = true;
                live.add(target);
            }
        }
        // A re-export entry (`export * from './test.mjs'`) delegates to the sibling that
        // owns the `run({…})`; that sibling is itself a seed here, so the delegation adds
        // nothing to read and is not a gap in the reading.
        const delegates = imports.some(({ target }) => isEntry.has(target));
        if (!registers && !delegates && !bound) opaque.push(entry);
    }

    // Reachability closes over spec-to-spec imports; liveness closes over the same edges
    // from the live specs only, because a helper is run by whoever imports it.
    while (queue.length > 0) {
        const file = queue.pop();
        for (const { target } of relativeImports(file, sources.get(file))) {
            if (!isSpec.has(target) || reachable.has(target)) continue;
            reachable.add(target);
            queue.push(target);
        }
    }
    const liveQueue = [...live];
    while (liveQueue.length > 0) {
        const file = liveQueue.pop();
        for (const { target } of relativeImports(file, sources.get(file))) {
            if (!isSpec.has(target) || live.has(target)) continue;
            live.add(target);
            liveQueue.push(target);
        }
    }

    return { src, entries, specs, reachable, live, opaque };
}

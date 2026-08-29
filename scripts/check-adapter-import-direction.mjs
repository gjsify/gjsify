#!/usr/bin/env node
// The adapters carry no widget knowledge — mechanically, and the check proves itself first.
//
// ADR 0027 § 7 decides that a framework adapter is a mapping and nothing else:
// the widget vocabulary, the property names and every insertion rule live in ONE
// descriptor table, because hand-maintained per-framework tables are what stalled
// react-gtk, react-native-gtk4 and svelte-gjs. A rule without a check is a rule
// that gets "simplified" back into the bug it prevents.
//
// This check deliberately did NOT ship with the host: a scan with nothing to scan
// reports green and proves nothing, which is the failure class this repository
// pays most for. It lands with the first adapter, and it refuses to run on an
// empty set.
//
// WHAT IT READS, and why every part of that sentence was a bug
//
// The walk is RECURSIVE over `{.ts,.mts,.cts,.tsx,.js,.mjs,.cjs,.jsx}`, and a file it cannot
// read is a FAILURE, not a skip. The first version called `readdirSync` once and filtered
// `f.endsWith('.ts')`, so an adapter carrying all three violation kinds passed in silence as
// `react.tsx`, `react.mts`, `react.jsx`, `react.js` or `adapters/react/index.ts` — each
// printing "1 adapter(s) carry no widget knowledge", exit 0 — while the identical bytes as
// `react.ts` reported three problems. `.js` is not hypothetical: this package's own build
// globs `src/**/*.{ts,js}`, and `status/status.json` names "No React adapter" as next work,
// so `react.tsx` is the file that plausibly arrives.
//
// The comment stripper is a STATEFUL scanner, not three regexes. `/\/\/.*$/` truncated a line
// at a `//` inside a string literal (`const u = 'https://x'; w.append(c);` passed), and a
// `/* … */` block whose continuation lines carry no leading `*` was scanned as code, so
// ordinary prose quoting a widget name FAILED the check. Prose may name a widget; code may not.
//
// It also lexes REGEX LITERALS, which the first stateful version did not — and that omission
// cost a violation as GREEN. `const re = /[/*]/;` is valid JS; read as code its `/*` opened
// block-comment state that ran to EOF, so a widget name and a placement call under it were
// swallowed and the run printed "1 adapter(s) carry no widget knowledge", exit 0, on a file the
// version this one replaced had failed. `/'/` was the loud twin: it left string state open,
// after which `//` stopped being a comment and PROSE was reported as a placement method.
//
// The two UNQUOTED patterns landed later, and each was a live violation at the time. `new
// Gtk.Box()` in the Vue adapter was the one concrete widget class in the whole adapter set and
// the quoted `WIDGET_NAME` could not see it; the `gi://Gtk` import that made it possible was
// not looked at either. They are separate checks on purpose — a value import of
// `@girs/gtk-4.0` is a runtime import with no `gi://`, and a `gi://` import used only for a
// type is still a toolkit dependency. What `WIDGET_VALUE` deliberately does NOT match is a TYPE
// annotation: every adapter writes `container: Gtk.Widget`, so a bare `Gtk.[A-Z]` would flag all
// three at once and be switched off within a day.
//
// The import matcher takes any RELATIVE specifier whose path segments include `descriptors`,
// `policies` or `registry`, extension or not, at any depth. It used to demand
// `../descriptors(/index)?.js` — which admitted neither `'../descriptors/gtk.js'` (the table is
// exported straight from `descriptors/gtk.ts`, the shortest import that reaches it), nor a bare
// `'../registry'`, nor `'../../registry.js'` from an adapter one directory down.
//
// It is a LINE-AND-SPECIFIER gate, not an adversarial-evasion gate: `'./../registry.js'`,
// `'../registry.js?v=1'`, string concatenation and computed member access are out of scope by
// construction and always were.
//
// AND IT CHECKS ITSELF. Every run verifies the patterns above against
// `adapter-import-direction-fixtures.mjs` before scanning anything real — one fixture per
// measured miss. Nothing checked the checker for two rounds of review, and each miss cost a
// human an A/B run to find. A checker whose patterns cannot see a violation prints the same
// green as a clean tree.
//
//   node scripts/check-adapter-import-direction.mjs [--pkg <dir>] [--self-test]

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, sep } from 'node:path';

import {
    CODE_SOURCE_EXTENSIONS,
    sourceExtensionRe,
} from '../packages/infra/manifest-conformance/lib/source-extensions.mjs';
import { ADAPTER_IMPORT_DIRECTION_FIXTURES, materializeFixture } from './adapter-import-direction-fixtures.mjs';

/** The package that owns the host, its table and its adapters. */
const PKG = 'packages/framework/gtk-host';

/** Where the adapters live inside it, and where the published `./<framework>` subpaths point. */
const ADAPTERS = join('src', 'adapters');
const PUBLISHED_ADAPTER = /^\.\/lib\/esm\/(adapters\/.+)\.js$/;

/**
 * Every extension this repository calls a source, read from the ONE vocabulary rather
 * than listed again here — the list this file used to carry was right and the three
 * walkers that carried their own were not, which is the argument for having one.
 *
 * It is deliberately WIDER than what the package builds: `build:gjsify` globs
 * `src/**\/*.{ts,js}`, so a `.tsx` adapter would be read by this check and never
 * compiled. That gap is real and belongs to the manifest, not here — a published
 * `./lib/esm/adapters/*.js` with no artifact behind it is what `verify-package-outputs`
 * is for. Narrowing this check to match the build would only mean reading less.
 */
const SOURCE_EXT = new Set(CODE_SOURCE_EXTENSIONS.map((ext) => `.${ext}`));

/** Prose and data. Any OTHER extension is a file this check could not read — a blocker. */
const NON_CODE_EXT = new Set(['.md', '.json']);

/** A spec asserts ON widget names and placements; it is not an adapter and is not scanned. */
const SPEC = /\.spec\.[cm]?[jt]sx?$/;

/** The GI namespaces a widget name can come from. One list, three patterns below. */
const NAMESPACES = '(?:Gtk|Adw|Gdk|Pango)';

/** A widget name literal — the table's job, not an adapter's. */
// Every string form, not just single quotes: a double-quoted or template-literal
// widget table is the exact violation this ratchet exists for, and matching one
// quote style made it pass. Found by review, A/B-verified.
const WIDGET_NAME = new RegExp(`['"\`]${NAMESPACES}[A-Z][A-Za-z]+['"\`]`);

/**
 * An UNQUOTED widget class, used as a VALUE.
 *
 * The quoted pattern above sees a table; it does not see `adopt(new Gtk.Box())`,
 * which is how the Vue adapter carried the one concrete widget class in the whole
 * adapter set for its whole life — ADR 0027 § 7 forbidden, and green.
 *
 * VALUE use only, and that is the whole difficulty: `Gtk.Widget` appears in every
 * adapter as a TYPE (`container: Gtk.Widget`, `as unknown as Gtk.Widget`) and is
 * erased at compile time, so a bare `Gtk\.[A-Z]` would flag all three adapters at
 * once and be turned off. `new`, `instanceof`, a call and `$gtype` are the
 * spellings TypeScript will not let you write against an `import type`.
 */
const WIDGET_VALUE = new RegExp(
    [`\\b(?:new|instanceof)\\s+${NAMESPACES}\\.[A-Z]\\w*`, `\\b${NAMESPACES}\\.[A-Z]\\w*\\s*(?:\\.\\$gtype|\\()`].join(
        '|',
    ),
);

/** Placement methods. Naming one here means an insertion rule leaked out of the table. */
const PLACEMENT = new RegExp(
    [
        'append',
        'prepend',
        'insert_child_after',
        'set_child',
        'set_content',
        'set_titlebar',
        'pack_start',
        'pack_end',
        'set_title_widget',
        'add_top_bar',
        'add_bottom_bar',
        'add_prefix',
        'add_suffix',
        'add_titled',
        'add_named',
        'attach',
        'reorder_child_after',
    ]
        .map((m) => `\\b${m}\\b`)
        .join('|'),
);

/** The table, the policies and the placement engine are the host's internals. */
const HOST_INTERNALS = new Set(['descriptors', 'policies', 'registry']);

/**
 * Published subpaths whose WHOLE POINT is carrying no UI framework, checked here for the
 * same reason the adapters are: a constraint asserted only in the prose that asserts it
 * has no ratchet, and this milestone has already paid for that class twice.
 *
 * `@gjsify/gtk-host/list` is the first. Its header says it "imports no React, no Solid
 * and no Vue, and must not — that constraint is the whole point", because the model, the
 * factory and the key diff behind a `Gtk.ListView` are GTK facts three dialects would
 * otherwise each own a copy of. Nothing stopped a future `import { createSignal } from
 * 'solid-js'` there: `src/adapters` is this check's only scope, and `src/list` was
 * covered by no gate at all.
 *
 * A NAME here, not a directory: the source dir is derived from the MANIFEST, so what a
 * package actually publishes is what gets read. That derivation has a hole this list
 * had to grow a second question to close — a subpath the manifest stops naming derives
 * to nothing, and nothing was silence. MEASURED: with a real `import { createSignal }
 * from 'solid-js'` under `src/list/`, deleting the one `"./list"` line from the
 * package's `exports` took the run from exit 1 to exit 0 printing "0 framework-free
 * source(s) carry no framework". So `evaluate` also asks whether `src/<name>` is
 * SITTING THERE, and an unpublished-but-present source is the `unscanned-framework-free`
 * blocker rather than a skip. Adding a neutral subpath to this list is how it gets its
 * ratchet; the only way off the ratchet is deleting the source.
 */
const FRAMEWORK_FREE_SUBPATHS = ['./list'];

/** `./lib/esm/<dir>/index.js` — where a framework-free subpath's source is, via `src/<dir>`. */
const PUBLISHED_ENTRY = /^\.\/lib\/esm\/(.+)\/index\.js$/;

/**
 * A UI framework, as a bare module specifier.
 *
 * Anchored and segment-bounded so `react` and `react-dom/client` match while a package
 * merely NAMED for one (`solid-js-is-not-this`) does not. `@vue/runtime-core` is the
 * spelling the host's own Vue adapter uses, and `vue` is what an application writes.
 *
 * THREE OF THESE ARE NOT `node_modules` NAMES, and leaving them out was a hole with a
 * dialect already standing in it. `react-native` does not match the `react` alternative
 * — the segment bound is what makes `react` safe — and `@gjsify/react-native` is the
 * first consumer this seam was extracted FOR, so it is the likeliest wrong import to
 * arrive here. `@gjsify/gtk-host/react` is the same violation reaching sideways: the
 * relative hop into `src/adapters` is caught by path, and the identical import spelled
 * as this package's own published subpath was not.
 */
const FRAMEWORK_SPECIFIER =
    /^(?:react|react-dom|react-native|react-reconciler|solid-js|vue|@vue\/[\w.-]+|preact|svelte|@gjsify\/react-native|@gjsify\/gtk-host\/(?:react|solid|vue))(?:\/|$)/;

/**
 * A `gi://` specifier is a RUNTIME typelib import, and no adapter may hold one.
 *
 * The type layer is `@girs/*` (ADR 0028 § 3), which an adapter imports with
 * `import type` and which therefore cannot produce a value. `gi://Gtk` can, and
 * having it is how the Vue adapter reached `new Gtk.Box()` at all. This catches
 * the ARRIVAL where `WIDGET_VALUE` catches the use, and neither subsumes the
 * other: a value import of `@girs/gtk-4.0` (no `type`) is a runtime import with no
 * `gi://` in it, and a `gi://` import that is only ever used for a type is a
 * toolkit dependency an adapter still must not declare.
 */
const RUNTIME_GI = /^gi:\/\//;

/**
 * A module specifier in every spelling that binds one: `from '…'`, a side-effect
 * `import '…'`, `await import('…')`, `require('…')`. Matched over the whole stripped file
 * rather than per line, so a specifier on the line BELOW its `from` is seen too.
 */
const SPECIFIER_SOURCE = String.raw`(?:\bfrom|\bimport|\brequire)\s*\(?\s*(['"\x60])([^'"\x60\n]+)\1`;

/** A character that ENDS an expression, so a `/` after it is division and never a regex. */
const ENDS_EXPRESSION = /[\w$)\]'"`<>]/;

/** Identifier characters, for the keyword lookback below. */
const IDENTIFIER = /[\w$]/;

/**
 * Keywords a `/` may FOLLOW and still open a regex. The previous character alone cannot tell
 * `return /x/` from `total / x`: both end in an identifier character.
 */
const REGEX_AFTER_KEYWORD = new Set([
    'await',
    'case',
    'delete',
    'do',
    'else',
    'in',
    'instanceof',
    'new',
    'of',
    'return',
    'throw',
    'typeof',
    'void',
    'yield',
]);

/**
 * The index just past a regex literal starting at `start`, or -1 if it does not close on its
 * line — in which case the `/` was division, or JSX, and reading it as a regex is what would
 * cost the rest of the line. Character classes are a region where `/` is literal, which is the
 * whole of `/[/*]/`; a backslash escapes the next character.
 */
function regexLiteralEnd(source, start) {
    let i = start + 1;
    let inClass = false;
    while (i < source.length) {
        const ch = source[i];
        if (ch === '\n') return -1;
        if (ch === '\\') {
            if (source[i + 1] === undefined || source[i + 1] === '\n') return -1;
            i += 2;
            continue;
        }
        if (inClass) {
            if (ch === ']') inClass = false;
        } else if (ch === '[') {
            inClass = true;
        } else if (ch === '/') {
            return i + 1;
        }
        i += 1;
    }
    return -1;
}

/**
 * Strip comments, keeping every other byte and every line boundary.
 *
 * Stateful because the four shapes a line-regex cannot decide are the ones that were wrong:
 * a `//` inside a string literal is not a comment, a `/* … *\/` block runs across lines whether
 * or not the continuation lines are decorated, a `${…}` inside a template literal is code
 * again, and a `/` may open a REGEX LITERAL. Strings are KEPT — a quoted widget name is the
 * violation being looked for — and so is a regex body.
 *
 * The note that used to stand here called the untracked regex "a false negative on a line".
 * It was measured, and it costs the FILE. `const re = /[/*]/;` is valid JS; read as code, its
 * `/*` opened block-comment state that ran to EOF, so the `'GtkBox'` and the `.append()` under
 * it vanished and the run printed "1 adapter(s) carry no widget knowledge", exit 0 — a
 * violation the PRE-rewrite script caught, lost as GREEN. The mirror image was loud rather than
 * dangerous: `/'/` left string state open, after which `//` stopped being a comment and prose
 * was reported as a placement method. `//` costs a line; `/*` costs the file.
 *
 * So a `/` opens a regex only when the previous significant character cannot END an expression
 * (or the word before it is a keyword like `return`) AND the literal CLOSES on its line — the
 * second half is not a heuristic, ECMAScript forbids a LineTerminator in a
 * RegularExpressionLiteral. Together they bound a miscall to the rest of ONE line.
 *
 * Still lexical, not a parser: `a < /re/.test(b)` reads as division, because `<` and `>` count
 * as ending an expression. That is what keeps a `.tsx` adapter's `</div>` out of regex state,
 * and `.tsx` is in SOURCE_EXT.
 */
function stripComments(source) {
    const lines = [];
    let current = '';
    const endLine = () => {
        lines.push(current);
        current = '';
    };

    /** `code` (top level, or a `${…}` expression) | `single` | `double` | `template`. */
    const stack = ['code'];
    /** Brace depth per `code` frame, so a `}` knows whether it closes a `${…}`. */
    const depth = [0];
    /** Whether a `/` here would open a regex, and the identifier before it for the keyword case. */
    let regexAllowed = true;
    let word = '';

    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        const next = source[i + 1];
        const top = stack[stack.length - 1];

        // Line accounting is state-independent: every reported line number depends on it.
        if (ch === '\n') {
            endLine();
            i += 1;
            continue;
        }

        if (top === 'code') {
            if (ch === '/' && next === '/') {
                while (i < source.length && source[i] !== '\n') i += 1;
                continue;
            }
            if (ch === '/' && next === '*') {
                i += 2;
                while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
                    if (source[i] === '\n') endLine();
                    i += 1;
                }
                i += 2;
                continue;
            }
            // A regex literal, kept whole. Tested only HERE — after `//` and `/*`, exactly the
            // order JS lexes them in — so `/[/*]/` is a regex and `/* … */` is still a comment.
            if (ch === '/' && (regexAllowed || REGEX_AFTER_KEYWORD.has(word))) {
                const end = regexLiteralEnd(source, i);
                if (end !== -1) {
                    current += source.slice(i, end);
                    regexAllowed = false;
                    word = '';
                    i = end;
                    continue;
                }
            }
            if (ch === "'" || ch === '"' || ch === '`') {
                stack.push(ch === "'" ? 'single' : ch === '"' ? 'double' : 'template');
            } else if (ch === '{') {
                depth[depth.length - 1] += 1;
            } else if (ch === '}') {
                if (depth[depth.length - 1] === 0 && stack.length > 1) {
                    depth.pop();
                    stack.pop();
                } else if (depth[depth.length - 1] > 0) {
                    depth[depth.length - 1] -= 1;
                }
            }
            if (!/\s/.test(ch)) {
                word = IDENTIFIER.test(ch) ? word + ch : '';
                regexAllowed = !ENDS_EXPRESSION.test(ch);
            }
            current += ch;
            i += 1;
            continue;
        }

        // Inside a string or a template literal.
        if (ch === '\\') {
            current += ch;
            if (next === '\n') {
                endLine();
            } else if (next !== undefined) {
                current += next;
            }
            i += 2;
            continue;
        }
        if (
            (top === 'single' && ch === "'") ||
            (top === 'double' && ch === '"') ||
            (top === 'template' && ch === '`')
        ) {
            stack.pop();
            regexAllowed = false;
            word = '';
            current += ch;
            i += 1;
            continue;
        }
        if (top === 'template' && ch === '$' && next === '{') {
            stack.push('code');
            depth.push(0);
            regexAllowed = true;
            word = '';
            current += '${';
            i += 2;
            continue;
        }
        current += ch;
        i += 1;
    }
    endLine();
    return lines;
}

/** Specifiers an adapter may not bind, with the offset each was found at. */
function importProblems(code) {
    const found = [];
    const pattern = new RegExp(SPECIFIER_SOURCE, 'g');
    let match = pattern.exec(code);
    while (match !== null) {
        const specifier = match[2];
        const segments = specifier.split('/').map((segment) => segment.replace(/\.[cm]?[jt]sx?$/, ''));
        if (specifier.startsWith('.') && segments.some((segment) => HOST_INTERNALS.has(segment))) {
            found.push({ kind: 'host-internal-import', specifier, index: match.index });
        } else if (RUNTIME_GI.test(specifier)) {
            found.push({ kind: 'runtime-gi-import', specifier, index: match.index });
        }
        match = pattern.exec(code);
    }
    return found;
}

/**
 * Framework imports in `code`, which has already been through the comment stripper.
 *
 * A TYPE-ONLY import is a violation here and is not one in an adapter, so this is a
 * separate pass rather than a flag on the one above: `import type { Component } from
 * 'vue'` compiles to nothing, but it means the neutral module is describing itself in a
 * framework's vocabulary, and the next edit makes it a value. The seam is generic in its
 * handle precisely so it needs no such type.
 */
function frameworkImports(code) {
    const found = [];
    const pattern = new RegExp(SPECIFIER_SOURCE, 'g');
    let match = pattern.exec(code);
    while (match !== null) {
        const specifier = match[2];
        // A RELATIVE hop into the adapters is the same violation wearing a path: every
        // adapter imports its framework, so reaching one reaches the framework.
        const viaAdapter = specifier.startsWith('.') && specifier.split('/').includes('adapters');
        if (FRAMEWORK_SPECIFIER.test(specifier) || viaAdapter) {
            found.push({ kind: 'framework-import', specifier, index: match.index });
        }
        match = pattern.exec(code);
    }
    return found;
}

/** What each import kind tells the reader to do instead. */
const IMPORT_ADVICE = {
    'host-internal-import': (specifier) => `imports the host's internals: ${specifier}`,
    'runtime-gi-import': (specifier) =>
        `imports a typelib at RUNTIME: ${specifier}. An adapter maps a framework contract onto the ` +
        `host ops and never touches GTK itself — take the type from @girs/* with "import type", and ` +
        `if a widget really has to be BUILT, that is a host op (see createDetachedContainer), not an ` +
        `adapter's business.`,
    'framework-import': (specifier) =>
        `imports a UI framework: ${specifier}. This subpath is published as framework-NEUTRAL — that ` +
        `is what lets one measurement serve every renderer instead of one copy per dialect. Put the ` +
        `framework-shaped half behind the seam the module already publishes (a callback the dialect ` +
        `supplies), or in that dialect's own adapter under src/adapters.`,
};

/** Every file under `dir`, recursively, sorted — symlinks resolved so a linked adapter counts. */
function walk(dir) {
    const found = [];
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const path = join(dir, entry.name);
        const kind = entry.isSymbolicLink() ? statSync(path) : entry;
        if (kind.isDirectory()) {
            found.push(...walk(path));
        } else if (kind.isFile()) {
            found.push(path);
        }
    }
    return found;
}

/** Split the walk into what is scanned, what is deliberately not, and what could not be read. */
function classify(files) {
    const scanned = [];
    const specs = [];
    const nonCode = [];
    const unreadable = [];
    for (const path of files) {
        const name = basename(path);
        if (SPEC.test(name)) {
            specs.push(path);
        } else if (SOURCE_EXT.has(extname(name))) {
            scanned.push(path);
        } else if (NON_CODE_EXT.has(extname(name))) {
            nonCode.push(path);
        } else {
            unreadable.push(path);
        }
    }
    return { scanned, specs, nonCode, unreadable };
}

/** The adapters the package PUBLISHES, as `adapters/<name>` module paths. */
function publishedAdapters(manifestPath) {
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
        return { error: error.message, modules: [] };
    }
    const modules = [];
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
        const file = typeof target === 'string' ? target : target?.default;
        const match = typeof file === 'string' ? PUBLISHED_ADAPTER.exec(file) : null;
        if (match !== null) modules.push({ subpath, module: match[1] });
    }
    return { error: null, modules };
}

function scanFile(path) {
    const found = [];
    const lines = stripComments(readFileSync(path, 'utf8'));
    lines.forEach((line, index) => {
        if (WIDGET_NAME.test(line)) {
            found.push({ kind: 'widget-name', line: index + 1, path, message: `names a widget type: ${line.trim()}` });
        }
        if (WIDGET_VALUE.test(line)) {
            found.push({
                kind: 'widget-value',
                line: index + 1,
                path,
                message:
                    `uses a widget class as a VALUE: ${line.trim()}. A type annotation is fine — this is a ` +
                    `construction, an instanceof, a call or a $gtype read, which only a runtime import can back.`,
            });
        }
        if (PLACEMENT.test(line)) {
            found.push({
                kind: 'placement-method',
                line: index + 1,
                path,
                message: `names a placement method: ${line.trim()}`,
            });
        }
    });
    const code = lines.join('\n');
    for (const hit of importProblems(code)) {
        found.push({
            kind: hit.kind,
            line: code.slice(0, hit.index).split('\n').length,
            path,
            message: IMPORT_ADVICE[hit.kind](hit.specifier),
        });
    }
    return found.sort((a, b) => a.line - b.line);
}

/** One framework-free source file: no framework import, by value or by type. */
function scanFrameworkFree(path) {
    const code = stripComments(readFileSync(path, 'utf8')).join('\n');
    return frameworkImports(code)
        .map((hit) => ({
            kind: hit.kind,
            line: code.slice(0, hit.index).split('\n').length,
            path,
            message: IMPORT_ADVICE[hit.kind](hit.specifier),
        }))
        .sort((a, b) => a.line - b.line);
}

/**
 * The framework-free subpaths, as { subpath, dir, byName } — TWO paths, not one.
 *
 * `dir` is what the MANIFEST points at, and it is what gets scanned: a package publishes
 * `./lib/esm/<dir>/index.js`, so `src/<dir>` is the source behind the promise. `byName`
 * is where the subpath's source would sit if the manifest stopped pointing at it, and it
 * exists because `dir` alone made the check switchable from `package.json` — see
 * `FRAMEWORK_FREE_SUBPATHS` for the measurement.
 */
function frameworkFreeDirs(pkgDir, manifestPath) {
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
        // The adapters pass already reports an unreadable manifest as `no-manifest`;
        // reporting it twice would say nothing new.
        return [];
    }
    const out = [];
    for (const subpath of FRAMEWORK_FREE_SUBPATHS) {
        const target = manifest.exports?.[subpath];
        const file = typeof target === 'string' ? target : target?.default;
        const match = typeof file === 'string' ? PUBLISHED_ENTRY.exec(file) : null;
        const name = subpath.replace(/^\.\//, '').split('/');
        out.push({
            subpath,
            declared: target !== undefined,
            dir: match === null ? null : join(pkgDir, 'src', ...match[1].split('/')),
            byName: join(pkgDir, 'src', ...name),
        });
    }
    return out;
}

/**
 * Scan one package. `blockers` are the reasons a green result would mean nothing — an empty
 * adapter set, a file the walk cannot read, a published adapter whose source it never reached.
 * That last pair is the vacuity guard's real question: counting FILES could never notice that
 * the NEWEST adapter is the one not being read.
 */
function evaluate(pkgDir) {
    const dir = join(pkgDir, ADAPTERS);
    const blockers = [];
    const problems = [];
    if (!existsSync(dir)) {
        blockers.push({
            kind: 'no-adapters-dir',
            message: `${dir} does not exist. If the adapters moved, update this script — do not delete it.`,
        });
        // Every array the reporter reads, even on the path that cannot reach it today: the
        // reporter's `result.specs.length` is a TypeError the moment a non-fatal blocker kind
        // is added, and the self-test below asserts these four exist for exactly that reason.
        return { dir, scanned: [], specs: [], nonCode: [], unreadable: [], problems, blockers, neutral: [] };
    }

    const { scanned, specs, nonCode, unreadable } = classify(walk(dir));

    for (const path of unreadable) {
        blockers.push({
            kind: 'unreadable-file',
            message:
                `${path} is in the adapters tree and this check does not read its extension. ` +
                'A file it cannot read reports the same green as a clean one. Either move it out of ' +
                'the adapters tree, or teach the check to read it — and that is TWO steps, not one: ' +
                'add the extension to the shared vocabulary in ' +
                '`packages/infra/manifest-conformance/lib/source-extensions.mjs` AND move the fixtures in ' +
                'adapter-import-direction-fixtures.mjs that MEASURE this blocker onto an extension ' +
                'the walk still cannot read. Both of them spell it .vue today, so adding .vue alone ' +
                'was measured to turn them into a SELF-TEST FAILURE: the check still exits 1, and ' +
                'the first step on its own is a dead end.',
        });
    }

    if (scanned.length === 0) {
        blockers.push({
            kind: 'no-adapter',
            message:
                `no adapter found under ${dir}. This check exists to hold adapters to ADR 0027 § 7; ` +
                'with none present it would report green and verify nothing. Remove the check or add ' +
                'the adapter.',
        });
    }

    const published = publishedAdapters(join(pkgDir, 'package.json'));
    if (published.error !== null) {
        blockers.push({
            kind: 'no-manifest',
            message:
                `cannot read ${join(pkgDir, 'package.json')}: ${published.error}. It names the adapters ` +
                'the package publishes, which is how this check knows what it must have read.',
        });
    }
    const scannedModules = new Set(
        scanned.map((path) =>
            relative(join(pkgDir, 'src'), path)
                .split(sep)
                .join('/')
                .replace(/\.[cm]?[jt]sx?$/, ''),
        ),
    );
    for (const { subpath, module } of published.modules) {
        if (!scannedModules.has(module)) {
            blockers.push({
                kind: 'unscanned-adapter',
                message:
                    `package.json publishes "${subpath}" as an adapter (${module}), and this check read ` +
                    `no source for it under ${dir}. An adapter it never opened is an adapter with no ratchet.`,
            });
        }
    }

    for (const path of scanned) problems.push(...scanFile(path));

    // The framework-free subpaths, held to the OTHER direction of the same idea: an
    // adapter must carry no widget knowledge, a neutral module must carry no framework.
    const neutral = [];
    for (const { subpath, declared, dir: srcDir, byName } of frameworkFreeDirs(pkgDir, join(pkgDir, 'package.json'))) {
        if (srcDir === null) {
            // A package that does not publish the subpath is not in scope — only
            // gtk-host declares one today, and every unrelated fixture would otherwise
            // blocker. UNLESS the source is sitting right there, which is the vacuity
            // this pass exists against: the manifest is the check's only route to the
            // directory, so one deleted `exports` line turned a real framework import
            // under `src/list/` from exit 1 into exit 0 (measured, see
            // `FRAMEWORK_FREE_SUBPATHS`).
            if (!existsSync(byName)) continue;
            blockers.push({
                kind: 'unscanned-framework-free',
                message:
                    `${byName} exists and this check never opened it: package.json ` +
                    (declared
                        ? `points "${subpath}" somewhere this check cannot follow — it reads ./lib/esm/<dir>/index.js.`
                        : `does not publish "${subpath}" at all.`) +
                    ' A framework-free source with no scan behind it is a promise with no ratchet.' +
                    ' Publish the subpath at its index, or take the name off FRAMEWORK_FREE_SUBPATHS' +
                    ' in the same commit that deletes the source.',
            });
            continue;
        }
        if (!existsSync(srcDir)) {
            blockers.push({
                kind: 'unscanned-framework-free',
                message:
                    `package.json publishes "${subpath}" as a framework-free subpath and its source ` +
                    `directory ${srcDir} does not exist. A promise of neutrality with no source read ` +
                    'is a promise with no ratchet.',
            });
            continue;
        }
        const files = classify(walk(srcDir));
        const sources = files.scanned;
        if (sources.length === 0) {
            blockers.push({
                kind: 'unscanned-framework-free',
                message: `"${subpath}" resolves to ${srcDir} and this check read no source there.`,
            });
            continue;
        }
        neutral.push(...sources);
        for (const path of sources) problems.push(...scanFrameworkFree(path));
    }

    return { dir, scanned, specs, nonCode, unreadable, problems, blockers, neutral };
}

const kinds = (entries) => entries.map((entry) => entry.kind).sort();

/**
 * Problems as the fixture spells them: `kind`, or `kind@<line>` where the LINE is the point.
 * Asserting kinds alone passes a fix that reports the right kind at the wrong line — and the
 * line is precisely what a comment stripper corrupts when it misreads a regex literal, so the
 * regex fixtures pin it. One `@` in a fixture's list pins the whole list.
 */
const problemsAs = (problems, expected) =>
    expected.some((entry) => entry.includes('@'))
        ? problems.map((problem) => `${problem.kind}@${problem.line}`).sort()
        : kinds(problems);

/** Run every fixture through `evaluate` and return the mismatches. */
function selfTest() {
    const root = mkdtempSync(join(tmpdir(), 'adapter-import-direction-'));
    const failures = [];
    try {
        for (const fixture of ADAPTER_IMPORT_DIRECTION_FIXTURES) {
            const result = evaluate(materializeFixture(fixture, root));
            const actual = {
                files: result.scanned.length,
                problems: problemsAs(result.problems, fixture.expect.problems),
                blockers: kinds(result.blockers),
            };
            const expected = {
                files: fixture.expect.files,
                problems: [...fixture.expect.problems].sort(),
                blockers: [...fixture.expect.blockers].sort(),
            };
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                failures.push(
                    `${fixture.name}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}` +
                        [...result.problems, ...result.blockers].map((entry) => `\n      · ${entry.message}`).join(''),
                );
            }
            const absent = ['scanned', 'specs', 'nonCode', 'unreadable'].filter((key) => !Array.isArray(result[key]));
            if (absent.length > 0) {
                failures.push(
                    `${fixture.name}\n      evaluate() returned no ${absent.join('/')} array. The reporter ` +
                        'reads .length off each of them — this is a TypeError at report time, not a wrong count.',
                );
            }
            const said = [...result.problems, ...result.blockers].map((entry) => entry.message).join('\n');
            for (const needle of fixture.expect.mentions ?? []) {
                if (!said.includes(needle)) {
                    failures.push(
                        `${fixture.name}\n      no message names ${JSON.stringify(needle)}. What an error ` +
                            `PRESCRIBES is part of the check.\n      said     ${JSON.stringify(said)}`,
                    );
                }
            }
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
    return failures;
}

const args = process.argv.slice(2);
const pkgIndex = args.indexOf('--pkg');
if (pkgIndex !== -1 && args[pkgIndex + 1] === undefined) {
    console.error('check-adapter-import-direction: --pkg needs a directory.');
    process.exit(1);
}
const pkgDir = pkgIndex === -1 ? PKG : args[pkgIndex + 1];

// The checker first. Its patterns are the whole check, and two rounds of review left misses in
// them that no run of the real scan could ever have shown.
const selfTestFailures = selfTest();
if (selfTestFailures.length > 0) {
    console.error(`check-adapter-import-direction: SELF-TEST FAILED, ${selfTestFailures.length} finding(s).\n`);
    for (const failure of selfTestFailures) console.error(`  ${failure}`);
    console.error('\nThe patterns in this script no longer report what the fixtures measure. Fix the');
    console.error('pattern, or — if the expectation is what changed — say so in the fixture.');
    process.exit(1);
}
const vectors = ADAPTER_IMPORT_DIRECTION_FIXTURES.reduce(
    (total, fixture) =>
        total +
        fixture.expect.problems.length +
        fixture.expect.blockers.length +
        (fixture.expect.mentions?.length ?? 0),
    0,
);
console.log(
    `check-adapter-import-direction: self-test green — ${ADAPTER_IMPORT_DIRECTION_FIXTURES.length} fixture(s), ` +
        `${vectors} vector(s).`,
);

if (args.includes('--self-test')) process.exit(0);

const result = evaluate(pkgDir);

if (result.blockers.length > 0) {
    console.error(`check-adapter-import-direction: ${result.blockers.length} blocker(s).\n`);
    for (const blocker of result.blockers) console.error(`  ${blocker.message}`);
    process.exit(1);
}

if (result.problems.length > 0) {
    console.error(`check-adapter-import-direction: ${result.problems.length} problem(s).\n`);
    for (const problem of result.problems) {
        console.error(`  ${problem.path}:${problem.line}  ${problem.message}`);
    }
    console.error('\nADR 0027 § 7: an adapter maps a framework contract onto the host ops and');
    console.error('carries no widget vocabulary and no insertion rule. Both live in the');
    console.error('descriptor table, so three adapters cannot disagree about GTK.');
    process.exit(1);
}

const skipped = result.specs.length + result.nonCode.length;
console.log(
    `check-adapter-import-direction: ${result.scanned.length} adapter(s) carry no widget knowledge` +
        `${skipped > 0 ? ` (${result.specs.length} spec(s), ${result.nonCode.length} non-code file(s) skipped)` : ''}` +
        `; ${result.neutral.length} framework-free source(s) carry no framework.`,
);

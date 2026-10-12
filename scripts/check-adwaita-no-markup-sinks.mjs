#!/usr/bin/env node
// No SHIPPING source in adwaita-web hands a string to the HTML parser.
//
// THE INCIDENT. Three `use-markup` surfaces rendered Pango markup with `innerHTML` —
// `<adw-banner>`'s title, `<adw-alert-dialog>`'s heading and body, plus the copy button's
// constant SVG. Mozilla's add-on reviewer flagged the first two: a `title` ATTRIBUTE is
// author- and input-controlled, and `innerHTML` PARSES what it is given, so `<img
// src=x onerror=…>` in a banner title ran its handler. The third was the same call on a
// constant, i.e. safe by accident — a `COPY_SVG` a future edit turns into something
// interpolating is the same bug with a slower fuse.
//
// Pango markup is not HTML: eleven tags, `<span>` attributes, five entities, NO scripting.
// `parsePangoMarkup` (`@gjsify/adwaita-core`) turns the string into a tree, and
// `renderPangoMarkup` (`pango-markup.ts`) builds nodes from it — so bold is still drawn,
// and nothing the string carries becomes an element it did not name.
//
// WHAT IT CHECKS. The four sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`,
// `document.write`) in every SHIPPING source under `packages/web/adwaita-web/src`,
// comments stripped first, so a file that only explains why not does not fail. The
// alternative to this file is a reviewer's report: outside a browser extension there is
// no party that reads a bundle for a sink, and the four sites below were all written as
// the obvious thing to write.
//
// WHAT IS DELIBERATELY OUT, each because its use is not a sink:
//   • SPECS (`*.spec.ts`) — a fixture MOUNTS markup (`host.innerHTML = '<adw-banner …>'`),
//     and that is the only way to get a parsed attribute value into an element at all.
//     A spec asserting on a sink is not shipping code; `pango-markup.spec.ts` is what
//     holds the renderer instead.
//   • the test entries (`test.browser.mts`, `test.mts`) — they register suites, and the
//     registration gate (`check-browser-test-registration.mjs`) already holds them.
//   • Anything OUTSIDE this package. `@gjsify/adwaita-nativescript` has no DOM, and the
//     GTK/framework pillars do not ship a browser surface; this gate is scoped to the one
//     package that bundles into an add-on.
//
// KNOWN LIMITS, stated rather than papered over. The scan is LEXICAL, so it sees a
// property written by a computed member (`el[prop] = value`) only if `prop` is spelled
// `innerHTML` somewhere else in the file — and a sink reached through a wrapper that
// takes the string (`render(el, markup)`) is invisible to it entirely. Both are the
// shapes `renderPangoMarkup` exists to replace, which is why the export is named and
// shared rather than inlined at each call site: the four sites this gate found were four
// separate decisions to reach for the sink.
//
// Usage: node scripts/check-adwaita-no-markup-sinks.mjs [--root <dir>]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    CODE_SOURCE_EXTENSIONS,
    sourceExtensionRe,
} from '../packages/infra/manifest-conformance/lib/source-extensions.mjs';
import { stripComments } from '../packages/infra/manifest-conformance/lib/strip-comments.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const SRC = join(ROOT, 'packages/web/adwaita-web/src');

/**
 * The HTML-parsing sinks, each with the replacement this tree uses instead.
 *
 * The guard before the name is "not a word character", which is what keeps
 * `myInnerHtmlSink =` out — and deliberately NOT a `.`, because `el.innerHTML` is the
 * shape every one of these sites had. The assignment tail (`=` / `+=`, never `==`) is
 * what separates a write from a read or from a type annotation.
 */
const SINKS = [
    {
        name: 'innerHTML',
        pattern: /(?:^|[^A-Za-z0-9_$])innerHTML\s*\+?=(?!=)/g,
        instead: 'createElement / textContent, or renderPangoMarkup',
    },
    {
        name: 'outerHTML',
        pattern: /(?:^|[^A-Za-z0-9_$])outerHTML\s*\+?=(?!=)/g,
        instead: 'createElement / textContent',
    },
    {
        name: 'insertAdjacentHTML',
        pattern: /(?:^|[^A-Za-z0-9_$])insertAdjacentHTML\s*\(/g,
        instead: 'createElement + append, or renderPangoMarkup',
    },
    {
        name: 'document.write',
        pattern: /(?:^|[^A-Za-z0-9_$])document\s*\.\s*write(?:ln)?\s*\(/g,
        instead: 'document.createElement / textContent',
    },
];

const SOURCE_RE = sourceExtensionRe(CODE_SOURCE_EXTENSIONS);
const SPEC_RE = /\.spec\.(?:ts|mts|cts|tsx)$/;
const TEST_ENTRY_RE = /^test\.(?:browser\.)?[cm]?tsx?$/;

/** Every shipping source file under `dir`, recursive, excluding specs and test entries. */
function shippingSources(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...shippingSources(path));
        else if (SOURCE_RE.test(entry.name) && !SPEC_RE.test(entry.name) && !TEST_ENTRY_RE.test(entry.name))
            found.push(path);
    }
    return found;
}

/** 1-based line of `index` in `code`, which `stripComments` keeps aligned with the source. */
const lineOf = (code, index) => code.slice(0, index).split('\n').length;

const failures = [];
const files = shippingSources(SRC);
let sinkCount = 0;

for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const posix = relative(ROOT, file).split('\\').join('/');
    for (const { name, pattern, instead } of SINKS) {
        for (const match of code.matchAll(pattern)) {
            sinkCount += 1;
            failures.push(`${posix}:${lineOf(code, match.index)} calls \`${name}\` — build nodes with ${instead}.`);
        }
    }
}

process.stdout.write(
    `check-adwaita-no-markup-sinks: ${files.length} shipping source(s) scanned, ${sinkCount} markup sink(s).\n`,
);

if (failures.length > 0) {
    process.stderr.write(`\ncheck-adwaita-no-markup-sinks: ${failures.length} problem(s):\n\n`);
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
    process.stderr.write(
        `\nA string handed to innerHTML is a string the BROWSER PARSES, so its own contents decide what becomes\n` +
            `a node. Pango markup is not HTML: render it through renderPangoMarkup\n` +
            `  (packages/web/adwaita-web/src/pango-markup.ts), which parses with\n` +
            `  parsePangoMarkup from @gjsify/adwaita-core and creates elements only for the tags\n` +
            `  pango knows. Unparseable markup stays text — the fallback gtk_label_set_markup takes.\n` +
            `  Specs are exempt on purpose: a fixture MOUNTS markup, and that is not shipping code.\n`,
    );
    process.exit(1);
}

process.exit(0);

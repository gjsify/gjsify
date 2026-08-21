#!/usr/bin/env node
// What `disconnectedCallback` releases, `connectedCallback` re-establishes.
//
// THE INCIDENT
//
// 33 of adwaita-web's element classes open `connectedCallback` with
// `if (this._initialized) return;` — the guard that keeps a custom element from
// rebuilding its subtree every time it enters a document. Three of them ALSO define a
// `disconnectedCallback`, and for those the guard is a leak: the teardown runs on the
// way out, the early return skips the rebind on the way back in, and the widget is deaf
// from then on. A bare RE-PARENT is enough — a slideshow slide, a client-side route
// change, moving a node between two containers. Measured:
//
//   - `<adw-navigation-split-view breakpoint="max-width: 720px">` lost its
//     ResizeObserver and never collapsed again, however narrow the page got;
//   - `<adw-popover>` lost the two document listeners and came back visible with
//     neither outside-click nor Escape dismissal — and the only ways to re-arm them
//     are the two that just died.
//
// Both were found by READING. Nothing failed, and nothing would have: a dead media
// query and a dead document listener change no markup, no class list and no box until
// something fires them.
//
// THE THREE SHAPES THAT ARE FINE, all already in the tree
//
//   1. the teardown RESETS the flag (`<adw-source-view>`), so the whole build re-runs;
//   2. `connectedCallback` guards the BUILD and keeps going — `_buildOnce()` plus an
//      unguarded `_bindToDocument()`, which `<adw-overlay-split-view>` wrote the
//      reasoning for, or `if (!this._initialized) { … }` with statements after it;
//   3. the guarded branch itself rebinds before returning:
//      `if (this._initialized) { this._observeSensitivity(…); return; }`.
//
// WHAT IT CHECKS
//
// For every class that guards its build with `_initialized` AND tears something down:
// every `this._<field>` the teardown touches must be reachable again from the path that
// runs on a SECOND connect — directly, or one hop into a method that path calls.
// Nothing here proves the rebind is CORRECT; it proves one exists. The other half is
// `packages/web/adwaita-web/src/connect-lifecycle.spec.ts`, which moves every registered
// element between parents in a real browser and measures what comes back.
//
// KNOWN EDGE, deliberately not chased: a virtual hook pair split across a base and its
// subclass (`AdwCheckBase.onConnected` / `onDisconnected`, overridden by `AdwRadio`) is
// followed only inside the class that DECLARES the callbacks. Resolving that needs
// cross-class dispatch, and the pair is itself the sanctioned shape — the subclass is
// reached from both paths by construction.
//
// Usage: node scripts/check-adwaita-connect-rebind.mjs [--root <dir>]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adwaitaWebElements } from './adwaita-elements.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];

function fail(lines) {
    console.error(`check-adwaita-connect-rebind: ${lines.join('\n  ')}`);
    process.exit(1);
}

/**
 * Blank out comment and string CONTENT, keeping every offset and newline.
 *
 * Brace matching has to run on code alone: a `}` in a message or a `{` in a doc comment
 * ends a method body several lines early, and a field named in a comment would count as
 * a rebind that is not there. Identifiers survive untouched, so everything below reads
 * the masked text and never the original.
 */
function maskNonCode(text) {
    const out = Array.from(text);
    const blank = (from, to) => {
        for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
    };
    // A STACK, not a flag: a substitution is code inside a template, and its own `}` has
    // to hand control back to the template rather than to the file. Read as a flag, the
    // closing backtick of the first template opened a second one and swallowed the rest
    // of the file — which is how `adw-alert-dialog.ts` came back "unbalanced".
    const frames = [{ template: false, depth: 0 }];
    let i = 0;
    while (i < text.length) {
        const frame = frames[frames.length - 1];
        const ch = text[i];
        if (frame.template) {
            if (ch === '\\') {
                blank(i, i + 2);
                i += 2;
            } else if (ch === '`') {
                out[i] = ' ';
                frames.pop();
                i += 1;
            } else if (text.slice(i, i + 2) === '${') {
                // The `{` stays a real brace and so does its `}`: balanced either way,
                // so the walk above never has to know a template was here.
                out[i] = ' ';
                frames.push({ template: false, depth: 0 });
                i += 2;
            } else {
                if (ch !== '\n') out[i] = ' ';
                i += 1;
            }
            continue;
        }
        const two = text.slice(i, i + 2);
        if (two === '//') {
            const end = text.indexOf('\n', i);
            blank(i, end === -1 ? text.length : end);
            i = end === -1 ? text.length : end;
        } else if (two === '/*') {
            const end = text.indexOf('*/', i + 2);
            blank(i, end === -1 ? text.length : end + 2);
            i = end === -1 ? text.length : end + 2;
        } else if (ch === "'" || ch === '"') {
            let k = i + 1;
            while (k < text.length && text[k] !== ch) k += text[k] === '\\' ? 2 : 1;
            blank(i, Math.min(k + 1, text.length));
            i = k + 1;
        } else if (ch === '`') {
            out[i] = ' ';
            frames.push({ template: true, depth: 0 });
            i += 1;
        } else if (ch === '{') {
            frame.depth += 1;
            i += 1;
        } else if (ch === '}') {
            if (frame.depth === 0 && frames.length > 1) frames.pop();
            else frame.depth -= 1;
            i += 1;
        } else {
            i += 1;
        }
    }
    return out.join('');
}

/** The body of the block whose opening `{` is at `open`, exclusive of both braces. */
function block(masked, open) {
    let depth = 0;
    for (let i = open; i < masked.length; i += 1) {
        if (masked[i] === '{') depth += 1;
        else if (masked[i] === '}') {
            depth -= 1;
            if (depth === 0) return { body: masked.slice(open + 1, i), end: i + 1 };
        }
    }
    return null;
}

/** Every `class X … { … }` in a masked file, body-only. */
function classBodies(masked, file) {
    const found = [];
    for (const match of masked.matchAll(/\bclass\s+([A-Za-z0-9_]+)[^{;]*\{/g)) {
        const open = match.index + match[0].length - 1;
        const scope = block(masked, open);
        if (scope === null) {
            throw new Error(`${file}: unbalanced braces in class ${match[1]} — this reader cannot be trusted on it.`);
        }
        found.push({ name: match[1], body: scope.body });
    }
    return found;
}

/** Every method declared directly in a class body: name → body. */
function methods(classBody) {
    const found = new Map();
    // `foo(…) {` at the start of a line, past the modifiers a member may carry. Getters
    // and setters are excluded by the `get`/`set` keyword staying part of the name.
    for (const match of classBody.matchAll(
        /(?:^|\n)\s*(?:(?:public|private|protected|static|readonly|async|override)\s+)*([A-Za-z_][A-Za-z0-9_]*)\s*\([^()]*\)\s*(?::\s*[^;{]+)?\{/g,
    )) {
        const open = classBody.indexOf('{', match.index + match[0].length - 1);
        const scope = block(classBody, open);
        if (scope !== null && !found.has(match[1])) found.set(match[1], scope.body);
    }
    return found;
}

/** Receivers of `<target>.<method>(` — `this._stack?` and `document`, never the bare method. */
const receivers = (code, method) =>
    [...code.matchAll(new RegExp(`([A-Za-z0-9_$.?]*)\\.${method}\\s*\\(`, 'g'))].map(([, target]) => target);

/**
 * What a body BINDS or RELEASES that outlives this element, by kind.
 *
 * Kind, not resource: the invariant from the incident is "only what reaches OUTSIDE the
 * element needs a teardown AND a rebind" — an observer, a listener on someone else's
 * node, a disposer handed back by a helper. An `addEventListener` on `this` is
 * deliberately NOT in here: it survives a detach and is collected with the element, which
 * is why `<adw-overlay-split-view>` binds its keydown handler once and never removes it.
 *
 * Coarse on purpose for the first two kinds: a class that disconnects two observers and
 * re-observes one passes here. That is the honest limit of a source-level reader — it
 * holds that a rebind EXISTS. Whether the rebind WORKS is measured in a real browser by
 * `connect-lifecycle.spec.ts`, which moves every registered element between parents.
 */
function outsideBindings(code, classMethods, direction) {
    const kinds = new Set();
    if (new RegExp(direction === 'release' ? '\\.disconnect\\s*\\(' : '\\.observe\\s*\\(').test(code)) {
        kinds.add('observer');
    }
    const listener = direction === 'release' ? 'removeEventListener' : 'addEventListener';
    if (receivers(code, listener).some((target) => target !== 'this')) kinds.add('outside listener');
    if (direction === 'release') {
        // `this._disposeBreakpoint?.()` — calling a FIELD is calling back whatever handed
        // it over; calling a method of this class is just control flow.
        for (const [, name] of code.matchAll(/\bthis\.(_[A-Za-z0-9_]*)\s*\?\.\s*\(/g)) {
            if (!classMethods.has(name)) kinds.add(`disposer ${name}`);
        }
    } else {
        for (const [, name] of code.matchAll(/\bthis\.(_[A-Za-z0-9_]*)\s*(?:\?\?|\|\||&&)?=[^=]/g)) {
            if (!classMethods.has(name)) kinds.add(`disposer ${name}`);
        }
    }
    return kinds;
}

/**
 * `code` plus the body of every method of this class it calls — ONE hop.
 *
 * One hop is what the tree's own rebinds need and no more: `connectedCallback` calls
 * `this._syncBreakpoint()`, and THAT is where `_disposeBreakpoint` is re-assigned. A
 * transitive walk would report a rebind because something four methods away mentions
 * the field, which is not the same claim.
 */
function reach(code, classMethods) {
    let text = code;
    for (const [, name] of code.matchAll(/\bthis\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
        const body = classMethods.get(name);
        if (body !== undefined) text += `\n${body}`;
    }
    return text;
}

/**
 * What runs on a SECOND connect — the empty string when the guard returns and nothing
 * else can run. `null` means "not guarded at all", where every connect rebuilds and
 * there is nothing for this check to hold.
 *
 * THROWS on a guard shape it cannot read: an unreadable guard would fall through as
 * "not guarded" and pass vacuously, which is the failure mode this whole file exists to
 * remove.
 */
function reconnectPath(connected, classMethods, where) {
    const body = connected.replace(/^\s+/, '');

    const earlyReturn = /^if\s*\(\s*this\._initialized\s*\)\s*return\s*;/.exec(body);
    if (earlyReturn !== null) return '';

    const guardedBranch = /^if\s*\(\s*this\._initialized\s*\)\s*\{/.exec(body);
    if (guardedBranch !== null) {
        const scope = block(body, body.indexOf('{'));
        // A branch that returns is the whole reconnect path; one that falls through
        // runs the rest of the callback too.
        return /\breturn\s*;/.test(scope.body) ? scope.body : scope.body + body.slice(scope.end);
    }

    const guardedBuild = /^if\s*\(\s*!\s*this\._initialized\s*\)\s*\{/.exec(body);
    if (guardedBuild !== null) {
        const scope = block(body, body.indexOf('{'));
        return body.slice(scope.end);
    }

    const guardedCall = /^if\s*\(\s*!\s*this\._initialized\s*\)\s*this\.[A-Za-z0-9_]+\(\)\s*;/.exec(body);
    if (guardedCall !== null) return body.slice(guardedCall[0].length);

    const buildOnce = /^this\.([A-Za-z0-9_]+)\(\)\s*;/.exec(body);
    if (
        buildOnce !== null &&
        /^\s*if\s*\(\s*this\._initialized\s*\)\s*return\s*;/.test(classMethods.get(buildOnce[1]) ?? '')
    ) {
        return body.slice(buildOnce[0].length);
    }

    // `AdwCarouselIndicator` sets `_initialized` and guards nothing with it — every
    // connect re-attaches. Reading the flag is not the same as branching on it, and a
    // callback that branches on it in a shape none of the five above match is the one
    // case that must not fall through as "unguarded".
    if (!/\bif\s*\([^)]*\b_initialized\b/.test(body)) return null;

    throw new Error(
        `${where}: connectedCallback branches on \`_initialized\` in a shape this check cannot classify. ` +
            'Use one of the three the tree already has — reset the flag in the teardown, guard the ' +
            'build and keep going, or rebind inside the guarded branch — or teach this reader the ' +
            'new one. An unreadable guard passes vacuously, which is the bug this file is about.',
    );
}

let defined;
try {
    defined = adwaitaWebElements(ROOT);
} catch (error) {
    // The reader throws on a vacuous scan by design; catch to keep this script's prefix.
    fail([error.message]);
}

const files = [...new Set(defined.values())].sort();
const problems = [];
let guarded = 0;

for (const file of files) {
    const masked = maskNonCode(readFileSync(join(ROOT, file), 'utf8'));
    let classes;
    try {
        classes = classBodies(masked, file);
    } catch (error) {
        fail([error.message]);
    }
    for (const { name, body } of classes) {
        const classMethods = methods(body);
        const connected = classMethods.get('connectedCallback');
        const disconnected = classMethods.get('disconnectedCallback');
        if (connected === undefined || disconnected === undefined) continue;

        let path;
        try {
            path = reconnectPath(connected, classMethods, `${file}: ${name}`);
        } catch (error) {
            fail([error.message]);
        }
        if (path === null) continue;
        guarded += 1;

        // The escape hatch that needs nothing else: the flag is cleared, so the next
        // connect runs the whole build again.
        if (/\bthis\._initialized\s*=\s*false\b/.test(reach(disconnected, classMethods))) continue;

        const released = outsideBindings(reach(disconnected, classMethods), classMethods, 'release');
        const rebound = outsideBindings(reach(path, classMethods), classMethods, 'bind');
        const lost = [...released].filter((kind) => !rebound.has(kind)).sort();
        if (lost.length === 0) continue;

        problems.push(
            `${file}: ${name} releases ${lost.join(' + ')} in disconnectedCallback and never re-establishes ` +
                `${lost.length === 1 ? 'it' : 'them'} on a later connect — a re-parent leaves it deaf.`,
            path.trim() === ''
                ? '    The `_initialized` early return IS the whole reconnect path, so nothing runs at all.'
                : `    What does run on a second connect re-establishes: ${[...rebound].sort().join(' + ') || 'nothing'}.`,
            '    Fix: split the build into `_buildOnce()` and leave the binding unguarded (see ' +
                '`adw-overlay-split-view`), rebind inside the guarded branch (see `adw-action-row`), or ' +
                'reset `_initialized` in the teardown (see `adw-source-view`).',
        );
    }
}

if (problems.length > 0) fail(problems);

// A floor, not a count: the point is that it grows without this file being edited. Zero
// classes in scope would mean the reader stopped matching, and every element would pass.
if (guarded === 0) {
    fail([
        'no element class was found that guards its build with `_initialized` AND defines a ' +
            'disconnectedCallback. Either the package moved or the method reader stopped matching — ' +
            'a scan with nothing in scope passes vacuously, so this is a failure, not a pass.',
    ]);
}

console.log(
    `check-adwaita-connect-rebind: OK — ${guarded} guarded element class(es) across ${files.length} files re-establish everything their teardown releases.`,
);

// Evaluates ONE bundle produced by `run.mjs` and prints what it found as JSON.
//
// IT RUNS IN A CHILD PROCESS ON PURPOSE. Both hosts below install globals
// (`HTMLElement`, `customElements`, `document`), and a suite that installed them in the
// test process would carry them into every later case — including the RED control, whose
// whole job is to fail while those globals are present.
//
// WHAT THE HOSTS ARE, AND WHY THEY DO NOT DECIDE THE ANSWER. Neither target's runtime
// exists here: a browser bundle wants a DOM, and a NativeScript bundle wants the ONE
// `@nativescript/core` the device runtime boots (which this build correctly leaves
// EXTERNAL). Both are stubbed — a recording `document` proxy, and a class per name in the
// bundle's own `@nativescript/core` import clause. The stubs cannot manufacture a widget
// class, and the suite proves it rather than asserting it: the same stub, over the same
// fixture built WITHOUT `--gi-renderer`, has to report `Class extends value undefined`.
// That control row is the reason a stub is admissible here at all.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , host, bundlePath, mode] = process.argv;

/** A recording stand-in for a DOM node/API — enough for a custom element to be defined. */
function domStub(label) {
    return new Proxy(function () {}, {
        get(target, property) {
            if (typeof property === 'symbol') return Reflect.get(target, property);
            if (property === 'length' || property === 'name' || property === 'prototype') {
                return Reflect.get(target, property);
            }
            return domStub(`${label}.${String(property)}`);
        },
        apply: () => domStub(`${label}()`),
        construct: () => domStub(`new ${label}`),
        has: () => true,
        set: () => true,
    });
}

const registry = new Map();

function installBrowserHost() {
    globalThis.HTMLElement = class HTMLElement {
        attachShadow() {
            return domStub('shadowRoot');
        }
    };
    globalThis.customElements = {
        define(name, ctor) {
            registry.set(name, ctor);
        },
        get(name) {
            return registry.get(name);
        },
        whenDefined: () => Promise.resolve(),
    };
    globalThis.document = domStub('document');
    globalThis.window = globalThis;
    return bundlePath;
}

/**
 * Write a `@nativescript/core` whose exports are exactly the names THIS bundle imports,
 * then re-home the bundle beside it so Node's resolver finds it. Read off the bundle, never
 * hand-listed: a hand-kept list would drift from what the renderer subclasses and the
 * failure would read as a missing widget.
 */
function installNativescriptHost() {
    const bundle = readFileSync(bundlePath, 'utf8');
    const names = new Set();
    for (const match of bundle.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@nativescript\/core['"]/g)) {
        for (const member of match[1].split(',')) {
            const trimmed = member.trim();
            if (trimmed) names.add(trimmed.split(/\s+as\s+/)[0].trim());
        }
    }
    const projectDir = join(dirname(bundlePath), 'ns-host');
    const coreDir = join(projectDir, 'node_modules', '@nativescript', 'core');
    mkdirSync(coreDir, { recursive: true });
    writeFileSync(
        join(coreDir, 'index.js'),
        [...names]
            .sort()
            .map((n) => `export class ${n} {}`)
            .join('\n') + '\n',
    );
    writeFileSync(
        join(coreDir, 'package.json'),
        JSON.stringify({
            name: '@nativescript/core',
            version: '0.0.0-e2e',
            type: 'module',
            exports: { '.': './index.js' },
        }),
    );
    writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({ name: 'gi-renderer-arms-host', type: 'module', private: true }),
    );
    const homed = join(projectDir, 'bundle.mjs');
    writeFileSync(homed, bundle);
    return homed;
}

const entry = host === 'browser' ? installBrowserHost() : installNativescriptHost();

const report = { host, mode, loaded: false, error: null };
let bundleModule;
try {
    bundleModule = await import(pathToFileURL(entry).href);
    report.loaded = true;
} catch (error) {
    report.error = `${error.constructor.name}: ${error.message}`;
    process.stdout.write(JSON.stringify(report));
    process.exit(0);
}

report.kind = bundleModule.kind ?? null;

if (mode === 'member') {
    try {
        bundleModule.reachAbsentMember();
        report.refusal = null;
    } catch (error) {
        report.refusal = error.message;
    }
} else {
    const subclass = bundleModule.ProbeRow ?? bundleModule.ProbeButton ?? null;
    const base = bundleModule.actionRow ?? bundleModule.button ?? null;
    report.protoIdentity = subclass !== null && base !== null && Object.getPrototypeOf(subclass) === base;
    if (host === 'browser') {
        report.registrySize = registry.size;
        report.registeredIdentity = base !== null && registry.get('adw-action-row') === base;
        try {
            const instance = new subclass();
            report.constructed = instance instanceof globalThis.HTMLElement;
        } catch (error) {
            report.constructed = false;
            report.constructError = `${error.constructor.name}: ${error.message}`;
        }
    } else {
        const core = await import(
            pathToFileURL(join(dirname(entry), 'node_modules', '@nativescript', 'core', 'index.js')).href
        );
        report.reachesCore =
            base !== null &&
            Object.values(core).some(
                (exported) => typeof exported === 'function' && base.prototype instanceof exported,
            );
    }
}

process.stdout.write(JSON.stringify(report));

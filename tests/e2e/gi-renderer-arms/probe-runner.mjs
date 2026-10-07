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

const NS_CORE_DOUBLE = join(
    dirname(new URL(import.meta.url).pathname),
    '../../../packages/nativescript-bridge/adwaita/src/testing/ns-core.mts',
);

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
    // `@gjsify/adwaita-web` follows the desktop appearance on import (`followDesktopAppearance`),
    // which observes `document.head` and listens for `focus` on the window. Every real browser
    // has both, so the host must too; they stay inert because nothing here mutates a DOM.
    globalThis.MutationObserver = class MutationObserver {
        observe() {}
        disconnect() {}
        takeRecords() {
            return [];
        }
    };
    globalThis.addEventListener = () => {};
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
    // The `template` row drives live widgets, which need the port's own runtime double of the
    // platform (`testing/ns-core.mts`, the one its tree specs build against) rather than one
    // empty class per name. `--app nativescript` keeps core external, so it is supplied here.
    writeFileSync(
        join(coreDir, 'index.js'),
        mode === 'template'
            ? `export * from ${JSON.stringify(pathToFileURL(NS_CORE_DOUBLE).href)};\n`
            : [...names]
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

/**
 * The `template` row builds and drives a live widget tree, which a recording stub cannot
 * answer (`instance._toggle.active` has to read back what was written), so it gets a real DOM.
 */
async function installLiveBrowserHost() {
    const { JSDOM } = await import('jsdom');
    const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    for (const name of [
        'HTMLElement',
        'Element',
        'Node',
        'Event',
        'CustomEvent',
        'MutationObserver',
        'DocumentFragment',
    ]) {
        globalThis[name] = window[name];
    }
    globalThis.customElements = window.customElements;
    globalThis.document = window.document;
    globalThis.window = globalThis;
    for (const name of ['addEventListener', 'removeEventListener', 'matchMedia', 'getComputedStyle']) {
        if (typeof window[name] === 'function') globalThis[name] = window[name].bind(window);
    }
    return bundlePath;
}

const entry =
    host === 'browser'
        ? mode === 'template'
            ? await installLiveBrowserHost()
            : installBrowserHost()
        : installNativescriptHost();

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
} else if (mode === 'template') {
    try {
        report.template = bundleModule.exercise();
    } catch (error) {
        report.templateError = `${error.constructor.name}: ${error.message}`;
    }
} else {
    const subclass = bundleModule.ProbeRow ?? bundleModule.ProbeButton ?? null;
    const base = bundleModule.actionRow ?? bundleModule.button ?? null;
    report.descends = bundleModule.descends ?? null;
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

// The pre-build JSX question: has this project configured JSX AT ALL, and does what it
// configured PRESERVE JSX?
//
// Neither answer is available from the bundler, and both decide whether a `--app gjs`
// build can produce anything loadable:
//
//  - NOTHING configured. oxc's transformer then applies its own default — the AUTOMATIC
//    runtime with `importSource: 'react'` — so a `.tsx` entry emits
//    `import { jsx } from "react/jsx-runtime"`. Rolldown reports the miss as an
//    `UNRESOLVED_IMPORT` WARNING, re-emits the specifier, and the build exits 0; `gjs -m`
//    on the artifact then dies with `ImportError: Module not found: react/jsx-runtime`.
//    MEASURED end to end on a two-line `.tsx` (exit 0, then exit 1 under gjs). The
//    artifact gate in `gjs-bundle-guard.ts` catches it too — but AFTER a full bundle, and
//    it can only name `react/jsx-runtime`, not the `.tsx` the reader has to fix. And the
//    default is never right for this target: `react/jsx-runtime` builds React elements,
//    which render NOTHING on a GTK host even on the project that happens to have react
//    installed.
//  - `preserve` configured. JSX is meant to survive the transform so a framework compiler
//    can take it (`babel-preset-solid`, the Vue SFC compiler). Whether one is REGISTERED
//    is not knowable here — a plugin declares no JSX capability — so this only reports
//    that JSX may survive, and the post-bundle syntax check decides.
//
// Both `gjsify.bundler.transform.jsx` and tsconfig `compilerOptions.jsx` reach oxc, and
// the explicit `transform.jsx` WINS: measured with tsconfig `"jsx": "react-jsx"` +
// `"jsxImportSource": "solid-js"` and `bundler.transform.jsx: "preserve"` — the artifact
// kept raw JSX. Measured too, and the reason `preserve` is matched literally rather than
// by "TS spellings that keep JSX": tsconfig `"jsx": "react-native"`, which TypeScript
// documents as preserving, is NOT preserved by oxc — it compiled to runtime calls.

/** The JSX-bearing extensions oxc classifies as JSX-capable. */
const JSX_SOURCE_RE = /\.(?:jsx|tsx|mjsx|cjsx|mtsx|ctsx)$/i;

export interface JsxConfigInput {
    /** `gjsify.bundler.transform.jsx`, exactly as configured (any of oxc's shapes). */
    transformJsx?: unknown;
    /** tsconfig `compilerOptions.jsx`. */
    tsconfigJsx?: string | undefined;
    /** tsconfig `compilerOptions.jsxImportSource` — names the runtime on its own. */
    tsconfigJsxImportSource?: string | undefined;
}

export interface JsxConfigVerdict {
    /** Did anything at all name a JSX policy? `false` means oxc's react default applies. */
    configured: boolean;
    /** Will JSX survive the transform, so that a compiler downstream must consume it? */
    preserves: boolean;
}

/**
 * Read the effective JSX policy.
 *
 * `configured` is deliberately satisfied by ANY value, `false` and an unrecognised string
 * included: the gate's subject is a project that said nothing, not one whose setting this
 * function fails to recognise. `transform.jsx: false` already fails the build loudly from
 * inside oxc (measured: exit 1), which is a legitimate way to answer the question.
 */
export function describeJsxConfig(input: JsxConfigInput): JsxConfigVerdict {
    const { transformJsx, tsconfigJsx, tsconfigJsxImportSource } = input;
    const configured = transformJsx !== undefined || tsconfigJsx !== undefined || tsconfigJsxImportSource !== undefined;
    const preserves = transformJsx !== undefined ? transformJsx === 'preserve' : tsconfigJsx === 'preserve';
    return { configured, preserves };
}

/**
 * Flatten Rolldown's three `input` shapes (string, array, name→path record) into the
 * paths themselves. Takes `unknown` on purpose: the caller holds a post-glob-expansion
 * `EntryPoints` from the bundler package, and this module has no business importing that
 * type to look at strings.
 */
export function collectEntryPaths(entryPoints: unknown): string[] {
    if (typeof entryPoints === 'string') return [entryPoints];
    if (Array.isArray(entryPoints)) return entryPoints.filter((e): e is string => typeof e === 'string');
    if (entryPoints !== null && typeof entryPoints === 'object') {
        return Object.values(entryPoints as Record<string, unknown>).filter((e): e is string => typeof e === 'string');
    }
    return [];
}

/** The first entry point whose extension carries JSX, or `undefined`. */
export function findJsxEntryPoint(entryPoints: readonly string[]): string | undefined {
    return entryPoints.find((entry) => JSX_SOURCE_RE.test(entry));
}

/**
 * The refusal. Names the file, what the default would do to it, and each of the three
 * settings that answer the question — the two automatic-runtime spellings and the
 * preserve-plus-compiler route.
 *
 * Scoped to `--app gjs` by its caller: on `--app node`/`--app browser` the react default
 * is a legitimate answer for a project that has react installed, and refusing there would
 * break real builds for a mistake they did not make.
 */
export function jsxConfigMissingError(entry: string): Error {
    return new Error(
        `gjsify build --app gjs: ${entry} contains JSX, but nothing configures a JSX transform — not ` +
            '`gjsify.bundler.transform.jsx`, and not tsconfig `compilerOptions.jsx`.\n\n' +
            "Left unset, the bundler's transformer defaults to the automatic runtime with " +
            '`importSource: "react"`, so the bundle would import `react/jsx-runtime`. GJS cannot resolve a ' +
            'bare specifier at all (no node_modules walker, no `exports` map), so the build would exit 0 with ' +
            'an UNRESOLVED_IMPORT warning and the artifact would abort at load with "ImportError: Module not ' +
            'found: react/jsx-runtime" — and where react IS installed it would render React elements, which a ' +
            'GTK host does nothing with.\n\n' +
            'Configure one of:\n' +
            '  - the automatic runtime, in package.json#gjsify:\n' +
            '      "bundler": { "transform": { "jsx": { "importSource": "@gjsify/gtk-host" } } }\n' +
            '  - the same thing in tsconfig.json, which the bundler also reads:\n' +
            '      "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@gjsify/gtk-host" }\n' +
            '  - preserved JSX plus the framework compiler that consumes it — `"jsx": "preserve"` (either\n' +
            '    place) and the plugin under `gjsify.bundler.plugins` (`babel-preset-solid` for Solid, the\n' +
            '    Vue SFC compiler for Vue).',
    );
}

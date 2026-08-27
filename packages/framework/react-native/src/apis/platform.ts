// `Platform` — the one API whose whole content is an OS decision.
//
// AND THAT IS A DECLARED FACT, NOT AN INCIDENTAL ONE. `process.platform` below puts
// this package in `manifest-conformance`'s `os-axis` candidate set (ADR 0018), which
// makes `gjsify.os` mandatory and every claim below `supported` mandatory to
// explain. That is the right outcome rather than a cost to route around: a layer
// that TELLS an application which operating system it is on has to say which ones
// it has been run on, and the declaration in `package.json` is where a consumer
// reads it.
//
// The alternative was deriving the OS from GObject introspection instead, and it
// was measured and rejected. `GLib.DIR_SEPARATOR === 92` identifies win32 exactly
// (it is GLib's own compile-time constant, and the spelling the devtools transport
// already uses), but nothing in GLib separates darwin from linux without an
// inference: `get_user_runtime_dir()` degrades to the cache dir on macOS AND on a
// Linux box with no `XDG_RUNTIME_DIR`, and `Gdk.Display`'s GType (`GdkMacosDisplay`)
// is only available after `Gtk.init()`, which `Platform.OS` must not require. An
// inference dressed as a measurement is worse than a declared read.
//
// WHY `OS` IS `'linux'`, WHICH REACT NATIVE'S OWN TYPE DOES NOT HAVE. React
// Native's `PlatformOSType` is `'ios' | 'android' | 'windows' | 'macos' | 'web'`.
// Reporting `'macos'` on a Linux desktop would be a lie a `Platform.select` cannot
// recover from; reporting `'web'` would be worse, because it is the one value that
// implies a DOM. A new member is the only honest answer, and the support table
// carries it as a named limit.

import { PrimitiveError } from '../primitives/errors.js';

/** What this layer reports. `'linux'` is not one of React Native's own five. */
export type PlatformOS = 'linux' | 'macos' | 'windows';

/** A `Platform.select` argument: one branch per OS, plus `default`. */
export type PlatformSelectSpec<T> = Partial<Record<PlatformOS | 'default', T>> & Readonly<Record<string, T>>;

const NODE_TO_OS: Readonly<Record<string, PlatformOS>> = {
    linux: 'linux',
    darwin: 'macos',
    win32: 'windows',
};

let cached: PlatformOS | null = null;

/**
 * The host operating system, read once.
 *
 * Read LAZILY rather than at module scope, so importing `Platform` in a
 * type-checking or bundling context that has no `process` is not an import-time
 * throw. A `Platform.OS` read that cannot be answered is a named error instead —
 * which is the difference between "this API does not work here" and "the module
 * failed to load and took the application with it".
 */
function hostOs(): PlatformOS {
    if (cached !== null) return cached;
    const raw = typeof process === 'undefined' ? undefined : (process.platform as string | undefined);
    if (typeof raw !== 'string') {
        throw new PrimitiveError(
            'Platform',
            'OS',
            'cannot be answered: there is no `process.platform` in this runtime. Under GJS it is supplied by gjsify’s injected globals, so a bundle built with `--globals none` has to declare `Platform.OS` itself',
        );
    }
    const os = NODE_TO_OS[raw];
    if (os === undefined) {
        throw new PrimitiveError(
            'Platform',
            'OS',
            `runs on "${raw}", which is outside the three operating systems ADR 0018 declares as the target set (linux, darwin, win32). Reporting one of the three anyway would make every \`Platform.select\` in the application wrong in a way nothing can detect`,
        );
    }
    cached = os;
    return os;
}

const REFUSE_VERSION =
    'is React Native’s MOBILE OS version — an Android API level or an iOS release — and a desktop has no counterpart that means the same thing. The GTK and libadwaita versions are the numbers that actually gate behaviour here, and they are `Gtk.get_minor_version()` / `Adw.get_minor_version()`, not a platform version';
const REFUSE_CONSTANTS =
    'is the native bridge’s constants object. There is no bridge here — this layer renders in-process onto GTK — so there is nothing to read it from, and a shim would be lying about a native module being present';

export const Platform = {
    /** `'linux' | 'macos' | 'windows'`. See the file header for why `'linux'` exists. */
    get OS(): PlatformOS {
        return hostOs();
    },

    /**
     * Pick the branch for this OS, falling back to `default`.
     *
     * `native` IS DELIBERATELY NOT CONSULTED, and it is the same decision as ADR
     * 0032 § 9's for `.native.tsx`: a `native` branch is by definition written for a
     * React Native runtime, and reaching for it would hand the GTK build code that
     * expects `NativeModules` — a failure that surfaces in a window rather than at
     * build time. Falling through to `default` is the honest outcome, and a spec
     * with neither this OS nor `default` is a named refusal that says so, rather
     * than React Native's own `undefined`.
     */
    select<T>(spec: PlatformSelectSpec<T>): T {
        const os = hostOs();
        if (os in spec) return spec[os] as T;
        if ('default' in spec) return spec.default as T;
        throw new PrimitiveError(
            'Platform',
            'select',
            `has no branch for "${os}" and no \`default\`. It was given: ${Object.keys(spec).sort().join(', ') || '(nothing)'}. ` +
                'A `native` branch is not consulted here — it is written for a React Native runtime and this is not one (ADR 0032 § 9) — so add a `default`',
        );
    },

    /** A desktop is not a television. Reported rather than refused, because it is a fact. */
    isTV: false,
    /** Likewise: this layer never runs React Native's own test harness. */
    isTesting: false,

    get Version(): never {
        throw new PrimitiveError('Platform', 'Version', REFUSE_VERSION);
    },
    get constants(): never {
        throw new PrimitiveError('Platform', 'constants', REFUSE_CONSTANTS);
    },
} as const;

/** Test seam: forget the cached OS so a spec can exercise the read more than once. */
export const resetPlatformCache = (): void => {
    cached = null;
};

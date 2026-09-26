// Node's `navigator` global (Node ≥21, refs/node/lib/internal/navigator.js).
//
// Web libraries probe `navigator` without a DOM: @mtcute/web reads `navigator.userAgent` as its
// device model and `'onLine' in navigator` for connectivity. Before this lived here, the only
// `navigator` on GJS came from @gjsify/dom-elements — an empty object, reachable only through a
// package that also carries the DOM, canvas and GdkPixbuf — so a CLI project without it got a
// `ReferenceError`. Same surface as Node minus `locks` (no Web Locks API on GJS yet): no `onLine`
// either, which Node does not have and a library must not be told about.

import GLib from '@girs/glib-2.0';
import process from '@gjsify/process';

const kInitialize = Symbol('kInitialize');

/** `navigator.platform` as browsers spell it, from Node's `process.platform`/`process.arch`. */
export function getNavigatorPlatform(arch: string, platform: string): string {
    if (platform === 'darwin') {
        // Browsers answer 'MacIntel' on Apple Silicon too.
        return 'MacIntel';
    } else if (platform === 'win32') {
        // And 'Win32' on 64-bit Windows.
        return 'Win32';
    } else if (platform === 'linux') {
        if (arch === 'ia32') return 'Linux i686';
        if (arch === 'x64') return 'Linux x86_64';
        return `Linux ${arch}`;
    } else if (platform === 'freebsd') {
        if (arch === 'ia32') return 'FreeBSD i386';
        if (arch === 'x64') return 'FreeBSD amd64';
        return `FreeBSD ${arch}`;
    } else if (platform === 'openbsd') {
        if (arch === 'ia32') return 'OpenBSD i386';
        if (arch === 'x64') return 'OpenBSD amd64';
        return `OpenBSD ${arch}`;
    } else if (platform === 'sunos') {
        if (arch === 'ia32') return 'SunOS i86pc';
        return `SunOS ${arch}`;
    } else if (platform === 'aix') {
        return 'AIX';
    }
    return `${platform[0].toUpperCase()}${platform.slice(1)} ${arch}`;
}

/**
 * Node spells its own runtime `Node.js/<major>`, Deno `Deno/<version>`, Bun `Bun/<version>`.
 * GJS's major is 1 forever, so the minor is what identifies a release.
 */
function gjsUserAgent(): string {
    const gjs = process.versions.gjs;
    if (!gjs) return 'GJS';
    const [major, minor] = gjs.split('.');
    return `GJS/${major}.${minor}`;
}

function illegalConstructor(): TypeError {
    const error = new TypeError('Illegal constructor') as TypeError & { code: string };
    error.code = 'ERR_ILLEGAL_CONSTRUCTOR';
    return error;
}

export class Navigator {
    // Private fields double as the brand check: reading one from a non-Navigator receiver
    // (`Navigator.prototype.userAgent`) throws a TypeError, as in Node.
    #availableParallelism: number | undefined;
    #userAgent: string | undefined;
    #platform: string | undefined;
    #languages: readonly string[] | undefined;

    constructor(key?: symbol) {
        if (key !== kInitialize) throw illegalConstructor();
    }

    /** Processors this process may run on — GLib reads the CPU affinity mask, as libuv does. */
    get hardwareConcurrency(): number {
        this.#availableParallelism ??= GLib.get_num_processors();
        return this.#availableParallelism;
    }

    /** The engine's default locale, which SpiderMonkey and Node's ICU both derive from `LANG`. */
    get language(): string {
        void this.#languages;
        // Read every time: Node re-queries too, because the default locale can change.
        return new Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
    }

    get languages(): readonly string[] {
        this.#languages ??= Object.freeze([this.language]);
        return this.#languages;
    }

    get userAgent(): string {
        this.#userAgent ??= gjsUserAgent();
        return this.#userAgent;
    }

    get platform(): string {
        this.#platform ??= getNavigatorPlatform(process.arch, process.platform);
        return this.#platform;
    }
}

for (const name of ['hardwareConcurrency', 'language', 'languages', 'userAgent', 'platform']) {
    Object.defineProperty(Navigator.prototype, name, { enumerable: true });
}

export const navigator = new Navigator(kInitialize);

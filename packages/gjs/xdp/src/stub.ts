// SPDX-License-Identifier: MIT
//
// The NAMED THROWING STUB for platforms with no portal and no driver (ADR 0144 § 2: a page and an
// Android app have other lifetimes). It imports nothing, so no GJS can leak into a browser or
// NativeScript bundle. Linking succeeds; the first call names the module, the runtime and the
// calling site.

interface UnsupportedError extends Error {
    code: string;
    errno: number;
    syscall: string;
    gjsifyModule: string;
    gjsifyRuntime: string;
}

function unsupported(runtime: string, name: string): never {
    const error = new Error(
        `[@gjsify/xdp/${runtime}] ${name} is not available on the ${runtime} platform: ` +
            'a page and a phone app have lifetimes of their own, so there is no background mode to ask for.',
    ) as UnsupportedError;
    error.code = 'ENOTSUP';
    error.errno = -45;
    error.syscall = name;
    error.gjsifyModule = 'xdp';
    error.gjsifyRuntime = runtime;
    throw error;
}

/** `XDP_BACKGROUND_FLAG_*`: values, not behaviour, so they stay real. */
export const BackgroundFlags = { NONE: 0, AUTOSTART: 1, ACTIVATABLE: 2 } as const;
export type BackgroundFlags = (typeof BackgroundFlags)[keyof typeof BackgroundFlags];

export function createStub(runtime: string) {
    class Portal {
        constructor() {
            unsupported(runtime, 'Portal');
        }
        static new(): never {
            return unsupported(runtime, 'Portal.new');
        }
    }
    return {
        Portal,
        XdpGtk4: { parent_new_gtk: (_window: unknown): null => null },
        requestBackground: (): never => unsupported(runtime, 'requestBackground'),
        setBackgroundStatus: (): never => unsupported(runtime, 'setBackgroundStatus'),
    };
}

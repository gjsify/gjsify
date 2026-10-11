// HOW THE ADDON IS REACHED ON THIS DEVICE — the one question no host test can answer.
//
// `host.nativescript.js`'s `resolveNativeRequire` walks a chain: webpack's rewritten
// `__non_webpack_require__`, then `globalThis.require`, then `globalThis.__nativeRequire`. Its
// unit test (`packages/node-gi/node-gi/test/host-nativescript.test.mjs`) drives that chain against
// a FAKE scope, which proves the order and the error message and nothing about reality: which link
// exists depends on what the bundler emitted and what the runtime installs on the global object.
// This suite is bundled by Vite into ESM, where webpack's rewrite never happens — so whether
// anything is left to load `system_lib://libnode_gi.so` is a property of @nativescript/android's
// V8 host, measurable only here.
//
// The chain is mirrored rather than imported: `resolveNativeRequire` is not a public export of
// `@gjsify/node-gi`, and reaching into `#host` from an app would make this spec depend on an
// internal path. `__non_webpack_require__` is probed as a BARE IDENTIFIER (`typeof`, which is safe
// on an undeclared name) because that is precisely how the host probes it — reading it off
// `globalThis` would answer a different question and always answer 'undefined'.
import { describe, expect, info, it } from '../reporter.js';
import { requireGi } from '../opt-in.js';

type GLibNamespace = {
    get_monotonic_time(): number;
    get_user_data_dir(): string;
    MAJOR_VERSION: number;
    MINOR_VERSION: number;
    MICRO_VERSION: number;
};

export default async function loaderProbe(): Promise<void> {
    await describe('node-gi on NativeScript: the native module loader', async () => {
        const scope = globalThis as unknown as Record<string, unknown>;
        const links: Array<[string, string]> = [
            ['__non_webpack_require__', typeof __non_webpack_require__],
            ['globalThis.require', typeof scope['require']],
            ['globalThis.__nativeRequire', typeof scope['__nativeRequire']],
        ];
        for (const [name, kind] of links) info(`${name} is ${kind}`);
        const taken = links.find(([, kind]) => kind === 'function');
        info(`resolveNativeRequire takes: ${taken?.[0] ?? '<none>'}`);

        await it('at least one link of the loader chain is a function', () => {
            // When this fails, nothing below can run and the message in `loadNativeHost` is the
            // one to read: the chain found no loader, so either this is not NativeScript or its
            // loader moved and the chain needs a new name.
            expect(taken !== undefined).toBe(true);
        });

        await it("requireGi('GLib', '2.0') reaches the addon", () => {
            // The whole payload in one call: the APK's `lib/<abi>/libnode_gi.so` dlopened through
            // the runtime loader, its DT_NEEDED closure resolved from the same directory, and
            // `GLib-2.0.typelib` found under the extracted `app/girepository-1.0`.
            const GLib = requireGi('GLib', '2.0') as GLibNamespace;
            expect(typeof GLib.get_monotonic_time()).toBe('number');
        });

        await it('the GLib behind it is the bundled one, not a stub', () => {
            const GLib = requireGi('GLib', '2.0') as GLibNamespace;
            info(`GLib ${GLib.MAJOR_VERSION}.${GLib.MINOR_VERSION}.${GLib.MICRO_VERSION}`);
            // A real GLib reports the version the closure was built from, and its user data dir
            // is the app-private one `configureEnvironment()` pointed XDG_DATA_HOME at — not
            // `/usr/share`, which exists on no Android device.
            info(`GLib.get_user_data_dir() = ${GLib.get_user_data_dir()}`);
            expect(GLib.MAJOR_VERSION).toBe(2);
        });

        await it('reports which ABI of the plugin was loaded', () => {
            // Recorded for the report: a universal APK carries both, and the one that loaded is
            // whatever the device's primary ABI picked out of `lib/`.
            const abis = android?.os?.Build?.SUPPORTED_ABIS;
            const primary = abis && abis.length > 0 ? String(abis[0]) : '<unknown>';
            info(`device primary ABI = ${primary}, model = ${String(android?.os?.Build?.MODEL)}`);
            expect(primary !== '<unknown>').toBe(true);
        });
    });
}

// The eighteen surfaces, and the invariant that replaced disjointness.
//
// BEFORE ADR 0036 the contract test asserted that the two support tables had DISJOINT
// key sets, because a name in both gave `explainUnsupported` two answers and
// `isImportable` whichever it looked in first — silently, since both lookups succeed.
// With eighteen surfaces the collision is the normal case: `StatusBar` is a
// `react-native` export AND the whole of `expo-status-bar`, `Image` is
// `react-native`'s and `expo-image`'s, `SafeAreaView` is in `react-native` and in
// `react-native-safe-area-context`.
//
// So the invariant moved rather than relaxed: the lookup takes the MODULE, and the
// vector that matters is that the same name gets DIFFERENT answers from different
// surfaces. `Image` from `react-native` is importable and `Image` from `expo-image` is
// not, and a gate that dropped the module would have gone green on the second.
//
// EVERY MODULE IS LOADED, which is the second half. A surface is three things (a
// table row, a gate entry, a module that really exports what the row says), and only
// importing all eighteen holds the third — a subpath that does not exist, or one whose
// exports disagree with its table, is invisible to the checker script.

import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import { afterEach, beforeEach, describe, expect, it, on, type Runtime } from '@gjsify/unit';
import { registerBuiltinWidgets } from '@gjsify/gtk-host';
import { gtkChildren, installDiagnosticsGate } from '@gjsify/gtk-host/conformance';
import { MINIMAL_TOKENS, type StyleTokens } from '@gjsify/gtk-host/style';
import { createRoot } from '@gjsify/gtk-host/react';
import { createElement, type ReactNode } from 'react';
import { SURFACE_MENTION, couldBeSurfaceSpecifier } from '@gjsify/rolldown-plugin-gjsify';

import { PrimitiveError } from '../primitives/errors.js';
import { configureStyle, resetStyleConfig } from '../style-config.js';
import { SURFACES, explainUnsupported, isImportable, surfaceFor } from '../support-table.js';
import { UnsupportedError } from '../unsupported.js';

import * as asyncStorage from './async-storage.js';
import * as expoAudio from './expo-audio.js';
import * as expoConstants from './expo-constants.js';
import * as expoFont from './expo-font.js';
import * as expoImage from './expo-image.js';
import * as expoLinking from './expo-linking.js';
import * as expoSplashScreen from './expo-splash-screen.js';
import * as expoStatusBar from './expo-status-bar.js';
import * as expoSystemUi from './expo-system-ui.js';
import * as expoVideo from './expo-video.js';
import * as expoWebBrowser from './expo-web-browser.js';
import * as gestureHandler from './react-native-gesture-handler.js';
import * as nativewind from './nativewind.js';
import * as safeArea from './react-native-safe-area-context.js';
import * as vectorIcons from './vector-icons.js';
import * as webview from './react-native-webview.js';
import { IONICONS, IONICONS_TARGETS, ioniconName } from './icon-map.js';
import * as reactNative from '../index.js';
import * as router from '../router/index.js';

/** Named identities, not a capability — the list `widgets.spec.ts` stands down on. */
const GTK_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];

const TOKENS: StyleTokens = { ...MINIMAL_TOKENS };

/**
 * Every surface's module, by the specifier the registry declares.
 *
 * A HAND-WRITTEN JOIN, and the only one in this mechanism: a namespace import needs a
 * static specifier, so nothing can derive this from the registry. What holds it is the
 * first vector below — a row with no module here fails, and a module here with no row
 * fails too, so the join cannot drift in either direction.
 */
const MODULES: Readonly<Record<string, Record<string, unknown>>> = {
    'react-native': reactNative as unknown as Record<string, unknown>,
    'expo-router': router as unknown as Record<string, unknown>,
    'expo-status-bar': expoStatusBar as unknown as Record<string, unknown>,
    'expo-font': expoFont as unknown as Record<string, unknown>,
    'expo-linking': expoLinking as unknown as Record<string, unknown>,
    'expo-web-browser': expoWebBrowser as unknown as Record<string, unknown>,
    'react-native-safe-area-context': safeArea as unknown as Record<string, unknown>,
    'react-native-gesture-handler': gestureHandler as unknown as Record<string, unknown>,
    '@react-native-async-storage/async-storage': asyncStorage as unknown as Record<string, unknown>,
    '@expo/vector-icons': vectorIcons as unknown as Record<string, unknown>,
    'expo-image': expoImage as unknown as Record<string, unknown>,
    'expo-constants': expoConstants as unknown as Record<string, unknown>,
    'expo-system-ui': expoSystemUi as unknown as Record<string, unknown>,
    'expo-splash-screen': expoSplashScreen as unknown as Record<string, unknown>,
    'expo-audio': expoAudio as unknown as Record<string, unknown>,
    'expo-video': expoVideo as unknown as Record<string, unknown>,
    'react-native-webview': webview as unknown as Record<string, unknown>,
    nativewind: nativewind as unknown as Record<string, unknown>,
};

/** A refusing export is a Proxy that throws on ANY unknown property read. */
function isRefusingProxy(value: unknown): boolean {
    if (value === null || (typeof value !== 'function' && typeof value !== 'object')) return false;
    try {
        void (value as Record<string, unknown>)['gjsify-refusal-probe'];
        return false;
    } catch (error) {
        return error instanceof UnsupportedError;
    }
}

const threw = (run: () => unknown): Error => {
    try {
        run();
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a refusal, and nothing was thrown');
};

function mounted(element: ReactNode, body: (container: Gtk.Box) => void): void {
    const container = new Gtk.Box();
    const root = createRoot(container);
    try {
        root.render(element);
        body(container);
    } finally {
        root.unmount();
    }
}

/**
 * A widget's GType name.
 *
 * `GObject.type_name(constructor.$gtype)` and not `constructor.name`: the JS
 * constructor's name is the binding's spelling (`GtkBox` under gjs) and the GType's
 * is GTK's own (`GtkBox`), so only the second is the same on both legs of ADR 0030's
 * one corpus. `widgets.spec.ts` reads it the same way.
 */
const typeOf = (widget: Gtk.Widget): string =>
    GObject.type_name((widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype) ??
    '(unregistered GType)';

export default async () => {
    await describe('the surface registry', async () => {
        await it('has a loaded module for every row, and a row for every module', async () => {
            const declared = SURFACES.map((surface) => surface.module).sort();
            expect(Object.keys(MODULES).sort()).toStrictEqual(declared);
            expect(declared.length).toBe(18);
        });

        await it('resolves a surface by its npm name AND by its target', async () => {
            // The gate reads the SOURCE text, where the alias has not run yet, so a
            // ported application's `expo-status-bar` and a gjsify-native one's
            // `@gjsify/react-native/expo-status-bar` are the same surface.
            for (const surface of SURFACES) {
                expect(surfaceFor(surface.module)?.module).toBe(surface.module);
                expect(surfaceFor(surface.target)?.module).toBe(surface.module);
            }
            expect(surfaceFor('react-native-web')).toBe(undefined);
            expect(surfaceFor('react')).toBe(undefined);
        });

        await it('gives every entry a status, a reason, and limits exactly when partial', async () => {
            const bad: string[] = [];
            for (const surface of SURFACES) {
                for (const [name, entry] of Object.entries(surface.table)) {
                    const where = `${surface.module}.${name}`;
                    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') bad.push(`${where}: no reason`);
                    if (entry.status === 'partial' && (entry.limits ?? []).length === 0)
                        bad.push(`${where}: no limits`);
                    if (entry.status !== 'partial' && entry.limits !== undefined) bad.push(`${where}: spurious limits`);
                    const scheduled = entry.status === 'planned' || entry.status === 'partial';
                    if (scheduled && entry.tier === undefined) bad.push(`${where}: scheduled with no tier`);
                    const schedulable = entry.status !== 'refused' && entry.status !== 'not-reachable';
                    if (!schedulable && entry.tier !== undefined) bad.push(`${where}: tier on a non-schedule`);
                }
            }
            expect(bad).toStrictEqual([]);
        });

        await it('answers the SAME name differently per module — the whole reason for the parameter', async () => {
            // THE VECTOR ADR 0036 EXISTS FOR. `Image` is `partial` in react-native and
            // `planned` in expo-image. A gate that dropped the module would ask the
            // registry in order, get react-native's answer, and let
            // `import { Image } from 'expo-image'` through — green, on a name nothing
            // implements.
            expect(isImportable('Image', 'react-native')).toBe(true);
            expect(isImportable('Image', 'expo-image')).toBe(false);
            expect(explainUnsupported('Image', 'expo-image')).toContain('expo-image');
            expect(explainUnsupported('Image', 'expo-image')).toContain('not implemented yet');
            // And the pair that IS answered on both sides, so the vector above is not
            // just "one of them is unimplemented".
            expect(isImportable('StatusBar', 'react-native')).toBe(true);
            expect(isImportable('StatusBar', 'expo-status-bar')).toBe(true);
            expect(isImportable('SafeAreaView', 'react-native-safe-area-context')).toBe(true);
        });

        await it('refuses a specifier no row declares, rather than falling open', async () => {
            expect(isImportable('View', 'react-native-web')).toBe(false);
            const message = explainUnsupported('View', 'react-native-web');
            expect(message).toContain('react-native-web');
            expect(message).toContain('not a surface this layer declares');
        });

        await it('sends an unknown name to the RIGHT script, per surface', async () => {
            // react-native's key set is held EQUAL to a committed snapshot, so an
            // unknown name there really does mean the table is stale.
            expect(explainUnsupported('NoSuchThing', 'react-native')).toContain('check-rn-surface');
            // Every other key set is DECLARED, so the same sentence would send a reader
            // to a script that compares the table with react-native — where the name is
            // correctly absent and they would find nothing.
            const declared = explainUnsupported('NoSuchThing', 'expo-font');
            expect(declared).toContain('expo-font');
            expect(declared.includes('check-rn-surface')).toBe(false);
            expect(declared).toContain('DECLARED');
        });

        await it('exports every name EXACTLY once — real or refusing, never both', async () => {
            // The constraint the whole mechanism rests on, across all eighteen modules.
            // A name that is real AND generated resolves to whichever `export *` lost
            // the tie, and the symptom is a working component that throws on its second
            // use.
            const wrong: string[] = [];
            for (const surface of SURFACES) {
                const module = MODULES[surface.module] as Record<string, unknown>;
                for (const name of Object.keys(surface.table)) {
                    // `default` is not reachable through a namespace's string keys in
                    // the same way, and it is checked on its own below.
                    if (name === 'default') continue;
                    const value = module[name];
                    const importable = isImportable(name, surface.module);
                    if (value === undefined) {
                        wrong.push(`${surface.module}.${name}: not exported at all`);
                        continue;
                    }
                    if (importable && isRefusingProxy(value)) {
                        wrong.push(`${surface.module}.${name}: importable, exported as a refusal`);
                    }
                    if (!importable && !isRefusingProxy(value)) {
                        wrong.push(`${surface.module}.${name}: refused, exported as a real value`);
                    }
                }
            }
            expect(wrong).toStrictEqual([]);
        });

        await it('is covered by the BUNDLER’s prefilters, for every row', async () => {
            // A PREFILTER THAT MISSES IS A GATE THAT IS OFF, silently and only for the
            // surface it missed — so the claim is asserted against the real registry
            // rather than a fixture. It lives here and not in the plugin's own spec
            // because the plugin is tier 1 and this layer is tier 3: a tier-1 package
            // may not depend on a higher tier, devDependency included, and this
            // direction is the one that is allowed.
            const missed = SURFACES.filter((surface) => !couldBeSurfaceSpecifier(surface.module));
            expect(missed.map((surface) => surface.module)).toStrictEqual([]);
            const unseen = SURFACES.filter(
                (surface) => !SURFACE_MENTION.test(`import { X } from '${surface.module}';`),
            );
            expect(unseen.map((surface) => surface.module)).toStrictEqual([]);
            // And the TARGET spelling, which a gjsify-native application writes and the
            // gate watches beside the npm name.
            const unseenTargets = SURFACES.filter(
                (surface) => !SURFACE_MENTION.test(`import { X } from '${surface.target}';`),
            );
            expect(unseenTargets.map((surface) => surface.target)).toStrictEqual([]);
            // A package that is NOT a surface must not be dragged in by the prefilter's
            // over-inclusiveness turning into a rewrite: the registry decides, and
            // `react-native-web` is not in it.
            expect(couldBeSurfaceSpecifier('react')).toBe(false);
            expect(surfaceFor('react-native-web')).toBe(undefined);
        });

        await it('gives a refusing default export the RIGHT surface’s sentence', async () => {
            // `export const default` is a syntax error and `export * from` never carries
            // a default, so the two surfaces whose default refuses declare it by hand.
            // The module is passed with it, which is what stops the one-argument lookup
            // answering from whichever table has a `default` first.
            for (const [module, namespace] of [
                ['expo-constants', expoConstants],
                ['react-native-webview', webview],
            ] as const) {
                const value = (namespace as unknown as { default: unknown }).default;
                expect(isRefusingProxy(value)).toBe(true);
                const error = threw(() => (value as () => unknown)());
                expect(error instanceof UnsupportedError).toBe(true);
                expect(error.message).toContain(module);
            }
        });
    });

    await describe('expo-linking’s URL arithmetic', async () => {
        await it('parses a http URL into expo-linking’s four fields', async () => {
            expect(expoLinking.parse('https://example.test/a/b?x=1&y=two')).toStrictEqual({
                scheme: 'https',
                hostname: 'example.test',
                path: 'a/b',
                queryParams: { x: '1', y: 'two' },
            });
        });

        await it('answers nulls for something it cannot parse, rather than throwing', async () => {
            // `parse(useURL() ?? '')` is the ordinary defensive call site, and a refusal
            // there would break code that is behaving correctly.
            expect(expoLinking.parse('not a url')).toStrictEqual({
                scheme: null,
                hostname: null,
                path: null,
                queryParams: null,
            });
        });

        await it('puts a custom scheme’s whole remainder in the path, which is the STANDARD’s answer', async () => {
            // Declared as a limit rather than fixed: `myapp:profile` has no authority
            // component, so the URL standard gives it a null hostname — which is not
            // always what a phone deep link meant, and is not this layer's to reinterpret.
            const parsed = expoLinking.parse('myapp:profile/42');
            expect(parsed.scheme).toBe('myapp');
            expect(parsed.hostname).toBe(null);
            expect(parsed.path).toBe('profile/42');
        });

        await it('answers null for the initial URL and for the hook, and says why in the table', async () => {
            expect(await expoLinking.getInitialURL()).toBe(null);
            expect(expoLinking.useURL()).toBe(null);
        });
    });

    await describe('expo-font, against the font map this machine has', async () => {
        await it('reports ready immediately, because nothing loads', async () => {
            expect(expoFont.useFonts({ Inter: 1 })).toStrictEqual([true, null]);
            expect(expoFont.isLoading()).toBe(false);
        });

        await it('answers isLoaded from Pango rather than from a stub', async () => {
            // THE RELATIONSHIP, never a specific family: which fonts are installed is a
            // fact about the machine. What is asserted is that SOME family answers true
            // and a nonsense one answers false — a stub returning a constant fails one
            // of the two whichever constant it picks.
            expoFont.resetFontCache();
            expect(expoFont.isLoaded('a-family-no-machine-has-x9q7')).toBe(false);
            const anyFamily = ['Cantarell', 'Adwaita Sans', 'DejaVu Sans', 'Liberation Sans'].some((family) =>
                expoFont.isLoaded(family),
            );
            expect(anyFamily).toBe(true);
        });

        await it('matches a family case-insensitively, which is what Pango does', async () => {
            const family = ['Cantarell', 'Adwaita Sans', 'DejaVu Sans', 'Liberation Sans'].find((name) =>
                expoFont.isLoaded(name),
            );
            expect(typeof family).toBe('string');
            expect(expoFont.isLoaded((family as string).toUpperCase())).toBe(true);
        });
    });

    await describe('the AsyncStorage document', async () => {
        const directory = GLib.build_filenamev([GLib.get_tmp_dir(), `gjsify-async-storage-${Date.now()}`]);
        const path = GLib.build_filenamev([directory, 'async-storage.json']);

        beforeEach(() => {
            asyncStorage.useStoreFile(path);
        });
        afterEach(() => {
            const target = Gio.File.new_for_path(path);
            if (target.query_exists(null)) target.delete(null);
            const parent = Gio.File.new_for_path(directory);
            if (parent.query_exists(null)) parent.delete(null);
            asyncStorage.resetAsyncStorage();
        });

        await it('round-trips through a real file, not through memory', async () => {
            // The point of the vector: after the write, the CACHE is dropped and the
            // value is read again — so what is asserted is the file, which is the half
            // an in-memory map would pass without.
            await asyncStorage.AsyncStorage.setItem('@app:token', 'abc');
            asyncStorage.useStoreFile(path);
            expect(await asyncStorage.AsyncStorage.getItem('@app:token')).toBe('abc');
            expect(Gio.File.new_for_path(path).query_exists(null)).toBe(true);
        });

        await it('keeps a key containing "=", which is why this is not a GLib.KeyFile', async () => {
            // MEASURED on glib 2.86: `g_key_file_set_string` with such a key prints a
            // GLib-CRITICAL and DROPS the write, returning normally. A store that
            // silently loses a key is the failure this whole layer exists against, so
            // the vector is the key itself.
            await asyncStorage.AsyncStorage.setItem('a=b', 'kept');
            await asyncStorage.AsyncStorage.setItem('has[bracket]', 'kept too');
            asyncStorage.useStoreFile(path);
            expect(await asyncStorage.AsyncStorage.getItem('a=b')).toBe('kept');
            expect([...(await asyncStorage.AsyncStorage.getAllKeys())].sort()).toStrictEqual(['a=b', 'has[bracket]']);
        });

        await it('removes, clears and answers the multi* forms', async () => {
            await asyncStorage.AsyncStorage.multiSet([
                ['a', '1'],
                ['b', '2'],
            ]);
            expect(await asyncStorage.AsyncStorage.multiGet(['a', 'b', 'c'])).toStrictEqual([
                ['a', '1'],
                ['b', '2'],
                ['c', null],
            ]);
            await asyncStorage.AsyncStorage.removeItem('a');
            expect(await asyncStorage.AsyncStorage.getItem('a')).toBe(null);
            await asyncStorage.AsyncStorage.multiRemove(['b']);
            expect(await asyncStorage.AsyncStorage.getAllKeys()).toStrictEqual([]);
            await asyncStorage.AsyncStorage.setItem('x', '1');
            await asyncStorage.AsyncStorage.clear();
            expect(await asyncStorage.AsyncStorage.getAllKeys()).toStrictEqual([]);
        });

        await it('merges one level deep, and REFUSES to overwrite a non-object', async () => {
            await asyncStorage.AsyncStorage.setItem('profile', JSON.stringify({ name: 'a', age: 1 }));
            await asyncStorage.AsyncStorage.mergeItem('profile', JSON.stringify({ age: 2 }));
            expect(JSON.parse((await asyncStorage.AsyncStorage.getItem('profile')) as string)).toStrictEqual({
                name: 'a',
                age: 2,
            });
            await asyncStorage.AsyncStorage.setItem('scalar', '"plain"');
            // The refusal is thrown INSIDE an `async` method, so it reaches the caller
            // as a rejected promise rather than a synchronous throw — `threw()` would
            // report "nothing was thrown" for a refusal that fired correctly.
            let rejected: unknown = null;
            await asyncStorage.AsyncStorage.mergeItem('scalar', '{"a":1}').catch((cause: unknown) => {
                rejected = cause;
            });
            expect(rejected instanceof PrimitiveError).toBe(true);
            expect((rejected as Error).message).toContain('silent data loss');
        });

        await it('refuses a non-string value by name, because the store keeps strings', async () => {
            let rejected: unknown = null;
            await (asyncStorage.AsyncStorage.setItem as unknown as (k: string, v: unknown) => Promise<void>)(
                'n',
                42,
            ).catch((cause: unknown) => {
                rejected = cause;
            });
            expect(rejected instanceof PrimitiveError).toBe(true);
            expect((rejected as Error).message).toContain('JSON.stringify');
        });

        await it('names the missing application id rather than writing beside the interpreter', async () => {
            asyncStorage.resetAsyncStorage();
            const existing = Gio.Application.get_default();
            if (existing === null) {
                let rejected: unknown = null;
                await asyncStorage.AsyncStorage.getItem('x').catch((cause: unknown) => {
                    rejected = cause;
                });
                expect(rejected instanceof PrimitiveError).toBe(true);
                expect((rejected as Error).message).toContain('application id');
            } else {
                // A suite that already built an application cannot un-build it, and
                // `Gio.Application` sets ITSELF as the default on construction (measured).
                // So the branch that can be reached is the other one: the id really is
                // used, and it is the application's own.
                expect(existing.applicationId).toBeTruthy();
            }
            asyncStorage.useStoreFile(path);
        });
    });

    await describe('the Ionicons mapping, against the icon theme that is installed', async () => {
        await it('targets an icon the theme really has, for every row', async () => {
            // THE HALF THAT CAN GO WRONG SILENTLY. GTK draws `image-missing` for an icon
            // name it does not have and reports nothing, so an unmeasured target would
            // put a broken-image glyph in a shipped application.
            Gtk.init();
            const display = Gdk.Display.get_default();
            expect(display !== null).toBe(true);
            const theme = Gtk.IconTheme.get_for_display(display as Gdk.Display);
            const missing = IONICONS_TARGETS.filter((name) => !theme.has_icon(name));
            expect(missing).toStrictEqual([]);
            // Not vacuous: an empty map satisfies an empty problem list.
            expect(IONICONS_TARGETS.length > 50).toBe(true);
            expect(Object.keys(IONICONS).length > 100).toBe(true);
        });

        await it('refuses an unmapped name, listing what IS mapped', async () => {
            const error = threw(() => ioniconName('no-such-ionicon'));
            expect(error instanceof PrimitiveError).toBe(true);
            expect(error.message).toContain('no-such-ionicon');
            expect(error.message).toContain('image-missing');
            expect(error.message).toContain('chevron-forward');
        });
    });

    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();
        const gated = (name: string, run: () => Promise<void>): Promise<void> =>
            describe(name, async () => {
                beforeEach(() => {
                    diagnostics.reset();
                    configureStyle({ tokens: TOKENS });
                });
                afterEach(() => {
                    resetStyleConfig();
                    diagnostics.assertQuiet();
                });
                await run();
            }) as Promise<void>;

        await gated('the surfaces that render, in a real tree', async () => {
            await it('draws an Ionicons name as the theme’s own icon', async () => {
                mounted(createElement(vectorIcons.Ionicons, { name: 'chevron-forward', size: 24 }), (container) => {
                    const image = gtkChildren(container)[0] as Gtk.Image;
                    expect(typeOf(image)).toBe('GtkImage');
                    expect(image.iconName).toBe(IONICONS['chevron-forward']);
                    expect(image.pixelSize).toBe(24);
                });
            });

            await it('renders SafeAreaProvider and SafeAreaView as boxes, not as nothing', async () => {
                // A provider that rendered nothing would be a window that silently went
                // blank, which is why the no-op is the INSET and not the component.
                mounted(
                    createElement(
                        safeArea.SafeAreaProvider,
                        null,
                        createElement(safeArea.SafeAreaView, null, createElement(reactNative.Text, null, 'hi')),
                    ),
                    (container) => {
                        const provider = gtkChildren(container)[0] as Gtk.Widget;
                        expect(typeOf(provider)).toBe('GtkBox');
                        const view = gtkChildren(provider)[0] as Gtk.Widget;
                        expect(typeOf(view)).toBe('GtkBox');
                        expect((gtkChildren(view)[0] as Gtk.Label).label).toBe('hi');
                    },
                );
            });

            await it('renders GestureHandlerRootView as a box', async () => {
                mounted(
                    createElement(
                        gestureHandler.GestureHandlerRootView,
                        null,
                        createElement(reactNative.Text, null, 'x'),
                    ),
                    (container) => {
                        expect(typeOf(gtkChildren(container)[0] as Gtk.Widget)).toBe('GtkBox');
                    },
                );
            });

            await it('renders expo-status-bar’s StatusBar as nothing at all', async () => {
                mounted(createElement(expoStatusBar.StatusBar, { style: 'auto' }), (container) => {
                    expect(gtkChildren(container).length).toBe(0);
                });
            });
        });
    });

    await describe('the safe-area constants', async () => {
        await it('is zero on every edge, and the same object every time', async () => {
            expect(safeArea.useSafeAreaInsets()).toStrictEqual({ top: 0, right: 0, bottom: 0, left: 0 });
            expect(safeArea.useSafeAreaInsets()).toBe(safeArea.useSafeAreaInsets());
        });

        await it('reports a ZERO frame in initialWindowMetrics, not a plausible one', async () => {
            // `Dimensions.get("window")` refuses a read before a window exists BY NAME
            // for this reason; a plausible number here would be the same lie in a value
            // nobody checks.
            expect(safeArea.initialWindowMetrics.frame).toStrictEqual({ x: 0, y: 0, width: 0, height: 0 });
        });
    });

    await describe('the surfaces answered on other tracks', async () => {
        await it('refuses every one of their names with a reason that names the track', async () => {
            const pointers: readonly (readonly [string, string, string])[] = [
                ['expo-audio', 'useAudioPlayer', 'Gtk.MediaFile'],
                ['expo-video', 'VideoView', 'Gtk.Video'],
                ['react-native-webview', 'WebView', 'WebKit'],
                ['nativewind', 'cssInterop', 'className'],
                ['expo-splash-screen', 'preventAutoHideAsync', 'Gio.Application'],
                ['expo-system-ui', 'setBackgroundColorAsync', 'application stylesheet'],
            ];
            for (const [module, name, mentions] of pointers) {
                expect(isImportable(name, module)).toBe(false);
                const message = explainUnsupported(name, module);
                expect(message).toContain(name);
                expect(message).toContain(mentions);
            }
        });
    });
};

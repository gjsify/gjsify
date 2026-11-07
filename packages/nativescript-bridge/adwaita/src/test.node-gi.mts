// THE REAL-GObject TEST ENTRY of this package — route D off a device (ADR 0105 stage 2).
//
// A THIRD entry beside `./test.mts` and `./test.trees.mts`, and the separation is the same one
// `./test.trees.mts`' header argues for, one step further. That entry aliases
// `@nativescript/core` onto the testing double so the port's REAL widgets can be built; this one
// does that too AND puts real GObject behind them, because route D — a declared property whose
// accessors are node-gi's, over a GType registered on a foreign NativeScript parent — is
// otherwise reachable only from an Android device. Folding these cases into `./test.trees.mts`
// would put the engine opt-in under every spec in that suite, replacing the pure-JS measurement
// the other sixty specs exist to make.
//
// `@gjsify/node-gi` is named HERE and nowhere else in the package, for the reasons
// `nativescript-bridge/gobject/src/test.node-gi.mts` spells out: it is no workspace member, so a
// static import in a type-checked file fails `build:types` with TS2307 on every other job
// (`tsconfig.json` excludes this entry), and the STATIC form is what flips the bundler's globals
// shim, where a dynamic `import()` would not count.
//
// RUN IT AS `node --conditions=gjsify-foreign-parents test.node-gi.mjs`. Registering a GType over
// a foreign parent is refused on a plain Node host ON PURPOSE — a program there can also be run
// under real GJS, which rejects such a base, so `host.node.js` keeps the capability off. The
// condition selects `host.node.foreign.js`, which overrides that one export and nothing else; it
// can only be passed on the process's own command line, which is why it is a test leg's flag and
// not a back door. Without it the check below stops the run rather than letting it measure the
// wrong engine.
//
// THE DYNAMIC IMPORT BELOW IS THE LOAD-BEARING LINE. `./namespace/gobject.js` calls
// `registeredEngine()` in its MODULE BODY and the core's slot freezes on that read, so the
// opt-in must be complete before any module that reaches the port is evaluated. ESM evaluates
// every static dependency before this file's own body runs, so a static import of the spec would
// freeze the slot on the default engine and `useRealGObjectEngine` would throw "registered too
// late" — the exact ordering rule `tests/integration/nativescript-gi/app/app.ts` honours with a
// side-effect import, which is unavailable here because the opt-in needs this file's own
// `requireGi`.
import { execFileSync } from 'node:child_process';
import { run } from '@gjsify/unit';
import requireGi from '@gjsify/node-gi/gi';
import { useRealGObjectEngine } from '@gjsify/adwaita-gobject-native';

// Before the opt-in, so a missing condition is named by its name instead of surfacing later as a
// registerClass refusal from inside the first widget's constructor.
const GObjectGi = requireGi('GObject', '2.0') as { $foreignParentClasses?: unknown };
if (GObjectGi.$foreignParentClasses !== true) {
    throw new Error(
        'This leg needs node-gi to allow a GType over a foreign NativeScript parent, which this ' +
            'host refuses. Run it as `node --conditions=gjsify-foreign-parents test.node-gi.mjs` ' +
            '(what `npm run test:gjs-on-node` does) so `#host` resolves to host.node.foreign.js.',
    );
}

useRealGObjectEngine(requireGi);

const { MenuModelRouteDNodeGiTest } = await import('./menu-model-route-d.node-gi.spec.js');
const { CheckButtonRouteDNodeGiTest } = await import('./check-button-route-d.node-gi.spec.js');
// A REAL Gtk.ToggleButton in its own process: it shares the GType name `GtkButton` with the port's.
const REAL_TOGGLE_SCRIPT = `
import requireGi from '@gjsify/node-gi/gi';
const Gtk = requireGi('Gtk', '4.0');
Gtk.init();
const [a, b, c] = [new Gtk.ToggleButton(), new Gtk.ToggleButton(), new Gtk.ToggleButton()];
const activate = [];
let groupNotifies = 0;
for (const [tag, button] of [['a', a], ['b', b], ['c', c]]) {
    button.connect('toggled', () => activate.push(tag + ':toggled'));
    button.connect('notify::active', () => activate.push(tag + ':notify::active'));
    button.connect('notify::group', () => groupNotifies++);
}
a.active = true;
b.set_group(a);
b.set_group(a);
b.set_group(null);
c.group = a;
console.log(JSON.stringify({ activate, groupNotifies }));
`;

// Software-only GTK render env for the real-GTK probe child. DISPLAY comes from the
// surrounding xvfb-run / real session / headless-run; these keep GTK off any GPU/
// Vulkan path a headless display cannot provide and off the a11y bus. Merged over the
// inherited env so a value already present (DISPLAY, WAYLAND_DISPLAY, NODE_GI_NATIVE)
// is preserved.
const RUN_ENV = {
    GSK_RENDERER: 'cairo',
    LIBGL_ALWAYS_SOFTWARE: '1',
    GTK_A11Y: 'none',
    NODE_GI_NATIVE: 'build',
    ...process.env,
};

const measureRealToggleButton = () =>
    JSON.parse(
        // oxlint-disable-next-line gjsify/spawn-node-binary -- this leg only ever runs on Node (see the header)
        execFileSync(process.execPath, ['--input-type=module', '-e', REAL_TOGGLE_SCRIPT], {
            cwd: import.meta.dirname,
            encoding: 'utf8',
            env: RUN_ENV,
        }),
    ) as { activate: string[]; groupNotifies: number };

const { createToggleButtonRouteDNodeGiTest } = await import('./toggle-button-route-d.node-gi.spec.js');

run({
    MenuModelRouteDNodeGiTest,
    CheckButtonRouteDNodeGiTest,
    ToggleButtonRouteDNodeGiTest: createToggleButtonRouteDNodeGiTest(measureRealToggleButton),
});

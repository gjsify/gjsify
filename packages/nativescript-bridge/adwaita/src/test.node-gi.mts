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

run({
    MenuModelRouteDNodeGiTest,
});

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

// A REAL Gtk.Stack in its own process: it shares the GType name `GtkStack` with the port's.
const REAL_STACK_SCRIPT = `
import requireGi from '@gjsify/node-gi/gi';
const Gtk = requireGi('Gtk', '4.0');
Gtk.init();

const record = (stack) => {
    const seen = [];
    stack.connect('notify::visible-child', () => seen.push('notify::visible-child'));
    stack.connect('notify::visible-child-name', () => seen.push('notify::visible-child-name'));
    return seen;
};

const addFirst = (() => {
    const stack = new Gtk.Stack();
    const seen = record(stack);
    stack.add_named(new Gtk.Label(), 'one');
    return seen;
})();

const setName = (() => {
    const stack = new Gtk.Stack();
    stack.add_named(new Gtk.Label(), 'one');
    stack.add_named(new Gtk.Label(), 'two');
    const seen = record(stack);
    stack.set_visible_child_name('two');
    return seen;
})();

const setChild = (() => {
    const stack = new Gtk.Stack();
    const one = new Gtk.Label();
    const two = new Gtk.Label();
    stack.add_named(one, 'one');
    stack.add_named(two, 'two');
    const seen = record(stack);
    stack.set_visible_child(two);
    return seen;
})();

const repeated = (() => {
    const stack = new Gtk.Stack();
    const one = new Gtk.Label();
    const two = new Gtk.Label();
    stack.add_named(one, 'one');
    stack.add_named(two, 'two');
    stack.set_visible_child_name('two');
    const seen = record(stack);
    stack.set_visible_child_name('two');
    stack.set_visible_child(two);
    return seen;
})();

const noMatch = (() => {
    const stack = new Gtk.Stack();
    const one = new Gtk.Label();
    stack.add_named(one, 'one');
    const seen = record(stack);
    stack.set_visible_child_name('missing');
    stack.set_visible_child(new Gtk.Label());
    return seen;
})();

console.log(JSON.stringify({ addFirst, setName, setChild, repeated, noMatch }));
`;

const measureRealStack = () =>
    JSON.parse(
        // oxlint-disable-next-line gjsify/spawn-node-binary -- this leg only ever runs on Node (see the header)
        execFileSync(process.execPath, ['--input-type=module', '-e', REAL_STACK_SCRIPT], {
            cwd: import.meta.dirname,
            encoding: 'utf8',
            env: RUN_ENV,
        }),
    ) as {
        addFirst: string[];
        setName: string[];
        setChild: string[];
        repeated: string[];
        noMatch: string[];
    };

// A REAL Adw.ViewStack in its own process: it shares the GType name `AdwViewStack` with the port's.
const REAL_ADW_VIEW_STACK_SCRIPT = `
import requireGi from '@gjsify/node-gi/gi';
const Adw = requireGi('Adw', '1');
const Gtk = requireGi('Gtk', '4.0');
Gtk.init();

const record = (stack) => {
    const seen = [];
    stack.connect('notify::visible-child', () => seen.push('notify::visible-child'));
    stack.connect('notify::visible-child-name', () => seen.push('notify::visible-child-name'));
    return seen;
};

const addFirst = (() => {
    const stack = new Adw.ViewStack();
    const seen = record(stack);
    stack.add_named(new Gtk.Label(), 'one');
    return seen;
})();

const setName = (() => {
    const stack = new Adw.ViewStack();
    stack.add_named(new Gtk.Label(), 'one');
    stack.add_named(new Gtk.Label(), 'two');
    const seen = record(stack);
    stack.set_visible_child_name('two');
    return seen;
})();

const setChild = (() => {
    const stack = new Adw.ViewStack();
    const one = new Gtk.Label();
    const two = new Gtk.Label();
    stack.add_named(one, 'one');
    stack.add_named(two, 'two');
    const seen = record(stack);
    stack.set_visible_child(two);
    return seen;
})();

const repeated = (() => {
    const stack = new Adw.ViewStack();
    const one = new Gtk.Label();
    const two = new Gtk.Label();
    stack.add_named(one, 'one');
    stack.add_named(two, 'two');
    stack.set_visible_child_name('two');
    const seen = record(stack);
    stack.set_visible_child_name('two');
    stack.set_visible_child(two);
    return seen;
})();

const noMatch = (() => {
    const stack = new Adw.ViewStack();
    const one = new Gtk.Label();
    stack.add_named(one, 'one');
    const seen = record(stack);
    stack.set_visible_child_name('missing');
    stack.set_visible_child(new Gtk.Label());
    return seen;
})();

console.log(JSON.stringify({ addFirst, setName, setChild, repeated, noMatch }));
`;

const measureRealAdwViewStack = () =>
    JSON.parse(
        // oxlint-disable-next-line gjsify/spawn-node-binary -- this leg only ever runs on Node (see the header)
        execFileSync(process.execPath, ['--input-type=module', '-e', REAL_ADW_VIEW_STACK_SCRIPT], {
            cwd: import.meta.dirname,
            encoding: 'utf8',
            env: RUN_ENV,
        }),
    ) as {
        addFirst: string[];
        setName: string[];
        setChild: string[];
        repeated: string[];
        noMatch: string[];
    };

// A REAL Adw.TabView in its own process: it shares the GType name `AdwTabView` with the port's.
const REAL_ADW_TAB_VIEW_SCRIPT = `
import requireGi from '@gjsify/node-gi/gi';
const Adw = requireGi('Adw', '1');
const Gtk = requireGi('Gtk', '4.0');
Gtk.init();

const record = (view) => {
    const seen = [];
    view.connect('notify::selected-page', () => seen.push('notify::selected-page'));
    return seen;
};

const addFirst = (() => {
    const view = new Adw.TabView();
    const seen = record(view);
    view.append(new Gtk.Label());
    return seen;
})();

const addSecond = (() => {
    const view = new Adw.TabView();
    view.append(new Gtk.Label());
    const seen = record(view);
    view.append(new Gtk.Label());
    return seen;
})();

const setPage = (() => {
    const view = new Adw.TabView();
    view.append(new Gtk.Label());
    const second = view.append(new Gtk.Label());
    const seen = record(view);
    view.set_selected_page(second);
    return seen;
})();

const repeated = (() => {
    const view = new Adw.TabView();
    view.append(new Gtk.Label());
    const second = view.append(new Gtk.Label());
    view.set_selected_page(second);
    const seen = record(view);
    view.set_selected_page(second);
    return seen;
})();

const closeSelected = (() => {
    const view = new Adw.TabView();
    const first = view.append(new Gtk.Label());
    view.append(new Gtk.Label());
    view.set_selected_page(first);
    const seen = record(view);
    view.close_page(first);
    return seen;
})();

const closeLast = (() => {
    const view = new Adw.TabView();
    const only = view.append(new Gtk.Label());
    const seen = record(view);
    view.close_page(only);
    return { seen, after: view.get_selected_page() === null };
})();

console.log(JSON.stringify({ addFirst, addSecond, setPage, repeated, closeSelected, closeLast }));
`;

const measureRealAdwTabView = () =>
    JSON.parse(
        // oxlint-disable-next-line gjsify/spawn-node-binary -- this leg only ever runs on Node (see the header)
        execFileSync(process.execPath, ['--input-type=module', '-e', REAL_ADW_TAB_VIEW_SCRIPT], {
            cwd: import.meta.dirname,
            encoding: 'utf8',
            env: RUN_ENV,
        }),
    ) as {
        addFirst: string[];
        addSecond: string[];
        setPage: string[];
        repeated: string[];
        closeSelected: string[];
        closeLast: { seen: string[]; after: boolean };
    };

// A REAL Adw.Carousel in its own process: it shares the GType name `AdwCarousel` with the port's.
const REAL_ADW_CAROUSEL_SCRIPT = `
import requireGi from '@gjsify/node-gi/gi';
const Adw = requireGi('Adw', '1');
const Gtk = requireGi('Gtk', '4.0');
Gtk.init();

const record = (carousel) => {
    const seen = [];
    carousel.connect('notify::position', () => seen.push('notify::position'));
    carousel.connect('notify::n-pages', () => seen.push('notify::n-pages'));
    return seen;
};

const addFirst = (() => {
    const carousel = new Adw.Carousel();
    const seen = record(carousel);
    carousel.append(new Gtk.Label());
    return { seen, nPages: carousel.get_n_pages(), position: carousel.get_position() };
})();

const addSecond = (() => {
    const carousel = new Adw.Carousel();
    carousel.append(new Gtk.Label());
    const seen = record(carousel);
    carousel.append(new Gtk.Label());
    return { seen, nPages: carousel.get_n_pages(), position: carousel.get_position() };
})();

const removeLast = (() => {
    const carousel = new Adw.Carousel();
    carousel.append(new Gtk.Label());
    const last = new Gtk.Label();
    carousel.append(last);
    const seen = record(carousel);
    carousel.remove(last);
    return { seen, nPages: carousel.get_n_pages() };
})();

const reorder = (() => {
    const carousel = new Adw.Carousel();
    carousel.append(new Gtk.Label());
    const last = new Gtk.Label();
    carousel.append(last);
    const seen = record(carousel);
    carousel.reorder(last, 0);
    return { seen, nPages: carousel.get_n_pages() };
})();

console.log(JSON.stringify({ addFirst, addSecond, removeLast, reorder }));
`;

const measureRealAdwCarousel = () =>
    JSON.parse(
        // oxlint-disable-next-line gjsify/spawn-node-binary -- this leg only ever runs on Node (see the header)
        execFileSync(process.execPath, ['--input-type=module', '-e', REAL_ADW_CAROUSEL_SCRIPT], {
            cwd: import.meta.dirname,
            encoding: 'utf8',
            env: RUN_ENV,
        }),
    ) as {
        addFirst: { seen: string[]; nPages: number; position: number };
        addSecond: { seen: string[]; nPages: number; position: number };
        removeLast: { seen: string[]; nPages: number };
        reorder: { seen: string[]; nPages: number };
    };

const { createToggleButtonRouteDNodeGiTest } = await import('./toggle-button-route-d.node-gi.spec.js');
const { createGtkStackRouteDNodeGiTest } = await import('./gtk-stack-route-d.node-gi.spec.js');
const { createAdwViewStackRouteDNodeGiTest } = await import('./adw-view-stack-route-d.node-gi.spec.js');
const { createAdwTabViewRouteDNodeGiTest } = await import('./adw-tab-view-route-d.node-gi.spec.js');
const { createAdwCarouselRouteDNodeGiTest } = await import('./adw-carousel-route-d.node-gi.spec.js');

run({
    MenuModelRouteDNodeGiTest,
    CheckButtonRouteDNodeGiTest,
    ToggleButtonRouteDNodeGiTest: createToggleButtonRouteDNodeGiTest(measureRealToggleButton),
    GtkStackRouteDNodeGiTest: createGtkStackRouteDNodeGiTest(measureRealStack),
    AdwViewStackRouteDNodeGiTest: createAdwViewStackRouteDNodeGiTest(measureRealAdwViewStack),
    AdwTabViewRouteDNodeGiTest: createAdwTabViewRouteDNodeGiTest(measureRealAdwTabView),
    AdwCarouselRouteDNodeGiTest: createAdwCarouselRouteDNodeGiTest(measureRealAdwCarousel),
});

// The shipped PAIR under GJS: `Spiel-1.0.typelib` resolving, and the library it
// names by bare leaf opening from beside it. The only two facts a prebuild has
// to deliver — everything Spiel then does is upstream's.
//
// NOTHING HERE TOUCHES THE SESSION BUS, by design and not by caution:
//
//   · A `Spiel.Speaker` enumerates providers over D-Bus and asks each for its
//     voices, which D-BUS-ACTIVATES them — this test would start speech-provider
//     daemons on the machine running it, and would answer differently on a
//     runner that has none. The live end-to-end check is `speak-fakesink.gjs.js`,
//     opt-in behind GJSIFY_SPIEL_LIVE=1.
//   · Registering the GObject TYPES is already the whole load question: every
//     `*_get_type()` below is a symbol girepository has to find in
//     `libspiel-1.0.so`, so a typelib naming a leaf that is not beside it, or a
//     version script that hid the API, fails right here.
//
// Run by meson with GI_TYPELIB_PATH/LD_LIBRARY_PATH pointing at the build
// directory, which is the one place all three artifacts sit together.

import GObject from 'gi://GObject?version=2.0';
import Spiel from 'gi://Spiel?version=1.0';

/** @param {boolean} ok @param {string} what */
function assert(ok, what) {
    if (!ok) throw new Error(`FAIL: ${what}`);
    console.log(`  ok  ${what}`);
}

// Resolving `gi://Spiel` loaded the TYPELIB only. Each `$gtype` read below runs
// the type-init function out of the library, so this is where it opens.
for (const name of ['Speaker', 'Utterance', 'Voice', 'Provider', 'VoicesListModel']) {
    assert(typeof Spiel[name]?.$gtype === 'object', `Spiel.${name} registers its GType from libspiel-1.0.so`);
}

// A real call through the library, not just type registration: an Utterance is
// a plain GObject with no bus and no provider behind it.
const utterance = new Spiel.Utterance({ text: 'prebuild check', pitch: 1.0, rate: 1.0 });
assert(utterance.text === 'prebuild check', 'Spiel.Utterance round-trips its text property');

// THE SILENCE SWITCH, asserted rather than described. `Speaker:sink` is what
// redirects synthesised audio away from the speakers (README.md § No audible
// output); the property is marked `introspectable="0"` in the GIR, so
// `speaker.sink = element` is a SILENT no-op in GJS and `set_property` is the
// only spelling that works. What this checks is that the property is on the
// class at all — if a libspiel bump removes it, every caller silently starts
// playing out loud.
//
// `Spiel.Speaker.find_property` and not `GObject.type_class_ref(…)`: the latter
// answers a boxed `GObject.TypeClass`, which carries none of `GObjectClass`'s
// methods in GJS (`.find_property is not a function`). GJS puts the class-struct
// methods on the CLASS instead, and they need no instance — which is the whole
// point here, since a Speaker cannot be constructed without a session bus.
assert(Spiel.Speaker.find_property('sink') !== null, 'Spiel.Speaker has the `sink` property');

for (const signal of ['utterance-started', 'utterance-finished', 'utterance-error']) {
    assert(GObject.signal_lookup(signal, Spiel.Speaker.$gtype) !== 0, `Spiel.Speaker emits \`${signal}\``);
}

console.log('load-typelib: Spiel-1.0.typelib resolved and libspiel-1.0.so opened beside it');

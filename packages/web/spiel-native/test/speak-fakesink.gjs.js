// THE LIVE END-TO-END CHECK — the one `load-typelib.gjs.js` deliberately does
// not do: find the speech providers on this session bus, synthesise one
// utterance and wait for `utterance-finished`.
//
// OPT-IN, behind GJSIFY_SPIEL_LIVE=1 (meson registers it either way; without the
// variable it exits 77 = skip). Two reasons, both about what it does to the
// machine running it:
//
//   · It D-BUS-ACTIVATES every `*.Speech.Provider` on the bus — real daemons,
//     started by a test run.
//   · Its answer depends on which providers are installed, so it is a
//     MEASUREMENT of a host, not an assertion about this build. A CI runner with
//     no provider is not a failure; see README.md § Provider discovery for the
//     numbers this produced here.
//
// NO AUDIBLE OUTPUT: `Speaker:sink` is set to a `fakesink` before `speak()` is
// ever called, so the synthesised audio is discarded instead of played. That
// property is `introspectable="0"` in the GIR, which means `speaker.sink = el`
// assigns a plain JS property and the pipeline keeps its default autoaudiosink —
// i.e. the WRONG spelling is silent about being wrong and loud about everything
// else. `set_property` is the only one that works.

import GLib from 'gi://GLib?version=2.0';
import Gst from 'gi://Gst?version=1.0';
import Spiel from 'gi://Spiel?version=1.0';
import System from 'system';

if (GLib.getenv('GJSIFY_SPIEL_LIVE') !== '1') {
    console.log('speak-fakesink: skipped (set GJSIFY_SPIEL_LIVE=1 to run against this session bus)');
    System.exit(77);
}

Gst.init(null);

const speaker = Spiel.Speaker.new_sync(null);

const sink = Gst.ElementFactory.make('fakesink', 'gjsify-spiel-silence');
if (sink === null) throw new Error('gstreamer has no `fakesink` — install gstreamer1-plugins-base/core');
speaker.set_property('sink', sink);

const providers = speaker.providers;
const voices = speaker.voices;
console.log(`providers on this session bus: ${providers.get_n_items()}`);
for (let i = 0; i < providers.get_n_items(); i++) {
    // `identifier`, not `well-known-name`: the latter is deprecated since 1.0.4
    // and reading it prints a GJS deprecation warning. Same bus name either way.
    const provider = providers.get_item(i);
    console.log(`  ${provider.identifier} — ${provider.name} (${provider.voices.get_n_items()} voices)`);
}
console.log(`voices: ${voices.get_n_items()}`);

if (voices.get_n_items() === 0) {
    console.log('speak-fakesink: no voices on this bus — nothing to synthesise (not a failure)');
    System.exit(77);
}

const loop = new GLib.MainLoop(null, false);
let failure = null;

speaker.connect('utterance-started', () => console.log('  utterance-started'));
speaker.connect('utterance-error', (_s, _u, error) => {
    failure = error?.message ?? 'utterance-error with no message';
    loop.quit();
});
speaker.connect('utterance-finished', () => {
    console.log('  utterance-finished');
    loop.quit();
});

// A hard stop, because every interesting failure here is a HANG: a provider
// that was activated and never answers leaves the loop running forever, and a
// test that never ends is indistinguishable from one that is slow.
GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
    failure = 'no utterance-finished within 30s';
    loop.quit();
    return GLib.SOURCE_REMOVE;
});

speaker.speak(new Spiel.Utterance({ text: 'Gjsify prebuild check.' }));
loop.run();

if (failure !== null) throw new Error(`speak-fakesink: ${failure}`);
console.log('speak-fakesink: synthesised one utterance into a fakesink');

// SPDX-License-Identifier: MIT
// @gjsify/node-gi — NON-LATIN TEXT RENDERS on the bundled GTK runtime (#1668).
//
// THE DEFECT, measured 2026-09-12 with Learn6502 0.8.0 on real hardware — macOS 15.7.9 and
// Windows 11, both running the published `--windowing` bundle:
//
//   Tamil    தமிழ்   default backend: TOFU     PANGOCAIRO_BACKEND=fc: renders
//   Japanese 日本語   default backend: renders  PANGOCAIRO_BACKEND=fc: renders
//   Linux (GJS, fontconfig)                    renders either way
//
// `pangocairo-fontmap.c` picks the first backend COMPILED IN — coretext → win32 → fc — so off
// Linux the shipped bundle drew through CoreText or pangowin32/DirectWrite, whose script
// fallback does not reach the Indic faces those systems install (`Tamil Sangam MN.ttc`,
// `Nirmala.ttf`: present on both machines the whole time). Every `FONTCONFIG_*` line the loader
// sets was being read by nobody. `maybeWireGtkWindowingEnv()` now also SELECTS the backend that
// reads them.
//
// A SET VARIABLE IS NOT A READ ONE, and that distinction is this file's reason to exist rather
// than a caveat inside it. Measured on the win32 windowing bundle in CI run 34873488108: with
// `PANGOCAIRO_BACKEND=fc` in `process.env`, the process still drew through a win32 map and Tamil
// still counted 5 unknown glyphs. That was first written up as "gvsbuild's pango has no
// fontconfig backend to select", and it was WRONG — that DLL registers `PangoCairoFcFontMap`,
// imports `fontconfig-1.dll`, and lists ` win32 fontconfig`. What Windows has instead is TWO
// ENVIRONMENTS: Node's `process.env` writer is `SetEnvironmentVariableW()`, which updates the
// Win32 block that `g_getenv()` reads and never the C runtime copy that `getenv()` reads — and
// `pango_cairo_font_map_new()` calls `getenv()`. `gi.js` mirrors the loader's writes across with
// `g_setenv()` on the first `requireGi()`, and this file is what holds that: it measures the
// LOADER-SET value against the same value placed in the LAUNCH environment, where the C runtime
// picks it up at startup and the question does not arise. It also asks the PROCESS which
// backends it has, by making pango print the list, so every branch below is taken on a
// measurement rather than on a platform name.
//
// JAPANESE PROVES NOTHING, AND THAT IS WHY IT IS NOT HERE. It came out right in the same window
// of the same run in which Tamil was empty boxes — both platform maps carry a CJK fallback — so
// a test built on it is green before and after the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gtkSource, resolveGtkRuntimeBundle } from '../gtk-runtime.js';
import { RESULT_PREFIX } from '../test-programs/pango-script-coverage.program.mjs';

const PROGRAM = fileURLToPath(new URL('../test-programs/pango-script-coverage.program.mjs', import.meta.url));

/**
 * The GType each `PANGOCAIRO_BACKEND` name builds. Both spellings pango accepts for fontconfig
 * are here, because the list it prints says `fontconfig` while the value it reads is `fc`.
 */
const MAP_TYPE_OF = {
    coretext: 'PangoCairoCoreTextFontMap',
    win32: 'PangoCairoWin32FontMap',
    fontconfig: 'PangoCairoFcFontMap',
    fc: 'PangoCairoFcFontMap',
};

const FC_MAP = MAP_TYPE_OF.fontconfig;

/**
 * The same predicate `maybeWireGtkWindowingEnv()` keys on, mirrored the way `windowing.test.mjs`
 * mirrors it: the bundle is the ACTIVE GTK and it carries the windowing data set. Anywhere else
 * — a system GTK, a display-free bundle — the backend request is deliberately not made, so
 * asserting its effect would be asserting something nothing set.
 */
function windowingBundleIsActive() {
    const bundle = resolveGtkRuntimeBundle();
    if (!bundle || gtkSource() !== 'bundle') return false;
    return existsSync(join(bundle.dir, 'share', 'glib-2.0', 'schemas', 'gschemas.compiled'));
}

/**
 * Run the measurement in a CHILD, optionally with `PANGOCAIRO_BACKEND` or `FONTCONFIG_FILE`
 * pinned. Returns the parsed result plus the child's stderr, which carries pango's diagnostics.
 *
 * A child and not this process, for three reasons that each bit something here: the variable is
 * read once when pango builds its default map, so an in-process A/B is impossible; the loader
 * re-execs itself on darwin and only a fresh process goes through that path; and the result is
 * taken from the line carrying RESULT_PREFIX rather than from stdout as a whole, because a GTK
 * stack that decides to print a diagnostic must not be able to become the measurement.
 */
function probe({ backend, fontconfigFile } = {}) {
    const env = { ...process.env };
    if (backend !== undefined) env.PANGOCAIRO_BACKEND = backend;
    if (fontconfigFile !== undefined) env.FONTCONFIG_FILE = fontconfigFile;
    const run = spawnSync(process.execPath, [PROGRAM], { env, encoding: 'utf8', timeout: 180_000 });
    const marker = (run.stdout ?? '')
        .split(/\r?\n/)
        .filter((line) => line.startsWith(RESULT_PREFIX))
        .pop();
    assert.ok(
        marker,
        `the probe printed no result line (status ${run.status}, signal ${run.signal})\n` +
            `--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}`,
    );
    return { ...JSON.parse(marker.slice(RESULT_PREFIX.length)), stderr: run.stderr ?? '' };
}

/** `{ latin: 0, tamil: 5, … }` — unknown-glyph counts by sample id. */
const counts = (result) => Object.fromEntries((result.samples ?? []).map((s) => [s.id, s.unknownGlyphs]));

let backendsMemo;

/**
 * WHICH BACKENDS THIS PANGO WAS BUILT WITH, asked of the process rather than inferred from the OS.
 *
 * `pango_cairo_font_map_new()` answers an unknown `PANGOCAIRO_BACKEND` with a g_critical naming
 * every backend compiled in, then returns NULL — measured, Pango 1.57.1: "Unknown
 * $PANGOCAIRO_BACKEND value.\n  Available backends are: fontconfig". That line is the only way a
 * running program can find out, and ADR 0038 § 3 already recommends it to a human holding a Mac.
 *
 * @returns {string[]} lower-cased backend names; empty when the line did not appear
 */
function availableBackends() {
    if (backendsMemo === undefined) {
        const { stderr } = probe({ backend: 'gjsify-no-such-backend' });
        const match = /Available backends are:\s*(.+)/.exec(stderr);
        backendsMemo = match
            ? match[1]
                  .split(',')
                  .map((name) => name.trim().toLowerCase())
                  .filter(Boolean)
            : [];
    }
    return backendsMemo;
}

/** True when pango here can build an Fc map at all, under either spelling it accepts. */
const fontconfigIsCompiledIn = () => availableBackends().some((name) => MAP_TYPE_OF[name] === FC_MAP);

test('the tofu counter answers in both directions before anything is concluded from it', (t) => {
    const result = probe();
    if (result.error) {
        t.skip(`no Pango on this host: ${result.error}`);
        return;
    }
    const seen = counts(result);

    // Stuck high — a host with no usable face at all — would make every assertion below pass for
    // the wrong reason, and that is exactly the state a wrongly-scoped fontconfig switch would
    // produce. So the first thing measured is that ordinary text draws.
    assert.equal(
        seen.latin,
        0,
        `"Hello" reports ${seen.latin} unknown glyph(s) on [${result.mapTypes}] — this process cannot draw ` +
            'Latin text either, so nothing further here is about scripts',
    );

    // Stuck at 0 — a counter that never reports tofu — is the failure mode that makes a green
    // suite meaningless. The SAME Tamil text as the claim below, with font fallback disabled,
    // cannot reach an Indic face through a Latin UI family on any of the three platforms.
    assert.ok(
        seen.tamilNoFallback > 0,
        `Tamil with pango_attr_fallback_new(FALSE) reports 0 unknown glyphs on [${result.mapTypes}]: the ` +
            'counter cannot be shown to see a missing glyph on this host, so it cannot be used as evidence ' +
            'that one arrived. Either "Sans" resolved to a Tamil-capable face here, or the oracle changed.',
    );

    console.log(
        `map [${result.mapTypes}] (PANGOCAIRO_BACKEND=${result.backend ?? 'unset'}), ${result.familyCount} ` +
            `families, tamil-capable families [${result.tamilFamilies}]; unknown glyphs latin=${seen.latin} ` +
            `tamil=${seen.tamil} tamil-no-fallback=${seen.tamilNoFallback}`,
    );
});

test('the backend the bundle selects is the backend it gets, or the gap is named', (t) => {
    if (!windowingBundleIsActive()) {
        t.skip('no active windowing bundle — the backend selection is scoped to the bundle, so nothing made it');
        return;
    }

    const backends = availableBackends();
    assert.ok(
        backends.length > 0,
        'an unknown PANGOCAIRO_BACKEND value did not make pango print its compiled-in backend list, so this ' +
            'file cannot tell "this pango has no such backend" from "the value never reached it" — and those ' +
            'are the two explanations for every count below, one of which has already been read as the other ' +
            'once. See ADR 0038 § Amendment 3.',
    );

    const shipped = probe();
    if (shipped.error) {
        t.skip(`no Pango on this host: ${shipped.error}`);
        return;
    }

    // What is asserted is the MAP, never the variable. `PANGOCAIRO_BACKEND=fc` being in
    // `process.env` says a write happened and nothing about whether the library that reads it saw
    // it — which is the whole finding this file was rewritten around.
    const gotFc = shipped.mapTypes.includes(FC_MAP);
    console.log(
        `backends compiled in: [${backends}]; loader set fc and the process built [${shipped.mapTypes}] ` +
            `(${shipped.familyCount} families). env at entry ${JSON.stringify(shipped.envAtEntry)}, ` +
            `after load ${JSON.stringify(shipped.envAfterLoad)}, g_getenv ${JSON.stringify(shipped.glibEnv)}; ` +
            `map types registered before the default map was built: [${shipped.mapTypesBefore}]`,
    );

    if (fontconfigIsCompiledIn()) {
        // THE REACH ARM, and it is the discriminator the first diagnosis of #1668 did not have.
        // The same value, in the LAUNCH environment instead of written by the loader, so the C
        // runtime has it before any of our code runs and `getenv()` cannot miss it. If this arm
        // gets the Fc map and the loader-set one does not, the backend was never the subject.
        const launched = probe({ backend: 'fc' });
        assert.ok(
            launched.mapTypes?.includes(FC_MAP),
            `this pango lists [${backends}], so fontconfig can be built, and PANGOCAIRO_BACKEND=fc in the ` +
                `LAUNCH environment still produced [${launched.mapTypes}]. That is not a reach problem and ` +
                'not a host property: either the backend list is wrong or something in the process is ' +
                'overriding the value.',
        );

        // The value CAN be honoured here and the loader set it, so it must have been honoured.
        assert.ok(
            gotFc,
            `this pango lists [${backends}] and PANGOCAIRO_BACKEND=fc in the launch environment builds ` +
                `[${launched.mapTypes}] — but the value written by the loader, which process.env reports as ` +
                `${JSON.stringify(shipped.envAfterLoad?.PANGOCAIRO_BACKEND)} and g_getenv as ` +
                `${JSON.stringify(shipped.glibEnv?.PANGOCAIRO_BACKEND)}, produced [${shipped.mapTypes}]. ` +
                'The variable is set and the library reading it cannot see it: on win32 that is the Win32 ' +
                'environment block vs the C runtime copy, which mirrorWindowingEnvIntoCrt() in gi.js exists ' +
                'to close (#1668).',
        );
        return;
    }

    // THE GAP, asserted rather than skipped so that it retires itself: a pango built without the
    // FreeType/fontconfig cairo backend has nothing to select, and then `PANGOCAIRO_BACKEND=fc`
    // genuinely is inert. NOT what win32 turned out to be — gvsbuild's pango lists ` win32
    // fontconfig` — so this branch is currently reached by no CI leg, and that is the point: it
    // is the shape the wrong diagnosis claimed, kept as a check rather than as a belief.
    assert.ok(
        !gotFc,
        `this pango lists [${backends}] — no fontconfig — and yet an Fc map was built. One of the two ` +
            'measurements is wrong, and which branch this file takes depends on which one.',
    );
    console.log(
        `PANGOCAIRO_BACKEND=fc is INERT here: pango lists [${backends}], which carries no fontconfig ` +
            'backend to select. #1668 is NOT fixed on this platform; see status/open-todos.md.',
    );
});

test('Tamil renders wherever the fontconfig backend can actually be selected', (t) => {
    if (!windowingBundleIsActive()) {
        t.skip('no active windowing bundle — nothing selected a backend here');
        return;
    }

    const shipped = probe();
    if (shipped.error) {
        t.skip(`no Pango on this host: ${shipped.error}`);
        return;
    }
    if (!shipped.mapTypes.includes(FC_MAP)) {
        // Named by the test above, which asserts WHY. Nothing to prove here: the claim is about
        // what selecting fontconfig buys, and this process did not get it.
        t.skip(`this process built [${shipped.mapTypes}] — the previous test holds the reason`);
        return;
    }

    const platformBackend = availableBackends().find((name) => MAP_TYPE_OF[name] && MAP_TYPE_OF[name] !== FC_MAP);
    if (platformBackend === undefined) {
        // Linux: fontconfig is the only backend compiled in, so there is no second arm to
        // contrast against and the fix is a measured no-op here. The counter half above still
        // ran, which is what this leg is for — it proves the TEST, not the implementation.
        t.skip(`only [${availableBackends()}] compiled in — no second backend to contrast against`);
        return;
    }

    const seen = counts(shipped);
    const tamil = shipped.samples.find((s) => s.id === 'tamil');

    // THE CONTROL, and without it everything below is a claim about a machine rather than about
    // this change. The platform's own backend must reproduce the defect — and, incidentally, this
    // proves the `setIfUnset` half: an operator's explicit value wins over the loader's.
    const control = probe({ backend: platformBackend });
    assert.ok(
        control.mapTypes?.includes(MAP_TYPE_OF[platformBackend]),
        `PANGOCAIRO_BACKEND=${platformBackend} produced [${control.mapTypes}]. Either the loader is overriding ` +
            'an explicitly-set value — which setIfUnset exists to prevent — or the backend list is wrong; in ' +
            'both cases this control is void rather than passing.',
    );
    const controlSeen = counts(control);
    assert.ok(
        controlSeen.tamil > 0,
        `the ${platformBackend} map draws Tamil with 0 unknown glyphs, so this test passes with AND without ` +
            'the PANGOCAIRO_BACKEND line and proves nothing. That is a finding, not a pass: the platform font ' +
            'map now reaches the script it did not reach on 2026-09-12, and the line in gtk-runtime.js needs ' +
            're-justifying against a fresh measurement.',
    );

    // A HOST WITH NO TAMIL FACE AT ALL is the one state in which the claim below cannot be put to
    // this machine, and it is a real one: a Windows SERVER image carries a far smaller font set
    // than the Windows 11 desktop the defect was measured on. Three conditions together, so that
    // this can never absorb a genuine failure — the count is non-zero (nothing is being hidden
    // that passed), NEITHER map lists a family that could carry the script, and both facts are
    // printed. A face the family heuristic misses still counts 0 and takes the assertion below.
    if (seen.tamil > 0 && shipped.tamilFamilies.length === 0 && control.tamilFamilies?.length === 0) {
        t.skip(
            `this host has no Tamil-capable font family under EITHER map — fc lists ${shipped.familyCount} ` +
                `families and none matching, ${platformBackend} lists ${control.familyCount} and none ` +
                `matching, and Tamil counts ${seen.tamil} on both. #1668 is about which faces a backend ` +
                'reaches, and this machine has none to reach; the map assertion in the test above is what ' +
                'holds the change here.',
        );
        return;
    }

    assert.equal(
        seen.tamil,
        0,
        `Tamil draws ${seen.tamil} unknown glyph(s) out of ${tamil.characters} characters on an Fc map ` +
            `reading ${shipped.fontconfigFile ?? 'fontconfig defaults'}. The host lists ${shipped.familyCount} ` +
            `families and [${shipped.tamilFamilies}] that could carry the script, against ` +
            `[${control.tamilFamilies}] on the ${platformBackend} map.`,
    );

    console.log(
        `tamil: fontconfig → ${seen.tamil} unknown glyph(s); ${platformBackend} → ${controlSeen.tamil}. ` +
            `Latin is ${seen.latin} on both.`,
    );
});

// THE HOST WE CANNOT RENT: a Mac with no Homebrew. Choosing fontconfig on darwin puts the
// process's whole font supply behind a configuration THIS BUNDLE DOES NOT SHIP — unlike win32,
// where `etc/fonts/fonts.conf` travels in the tarball and the loader points `FONTCONFIG_FILE` at
// it. What the darwin bundle gets instead is whatever its fontconfig was compiled to look for,
// which is the BUILD machine's Homebrew prefix. Every macOS runner has Homebrew, so a green leg
// would say nothing about the machine a stranger downloads the `.app` to — and that failure mode
// is not the one this change fixes, it is worse: a font map with nothing on it, every glyph
// gone, Latin included.
//
// So the missing host is SIMULATED rather than assumed: a config path that does not exist makes
// fontconfig fall back to the configuration compiled into the library, which is what a Mac
// without that prefix produces. Verified on Linux that the mechanism does what it claims —
// "Cannot load default config file" on stderr, and the built-in fallback still resolving
// `/usr/share/fonts`, latin=0 tamil=0.
test('a host with no fontconfig configuration at all still has fonts', (t) => {
    if (!windowingBundleIsActive()) {
        t.skip('no active windowing bundle — nothing selected a backend here');
        return;
    }
    const shipped = probe();
    if (shipped.error || !shipped.mapTypes?.includes(FC_MAP)) {
        t.skip('fontconfig is not the map here, so no fontconfig configuration is load-bearing');
        return;
    }

    const bare = probe({ fontconfigFile: join(tmpdir(), 'gjsify-no-such-fonts.conf') });
    const seen = counts(bare);
    assert.equal(
        seen.latin,
        0,
        `with no readable fontconfig configuration this process draws ${seen.latin} unknown glyph(s) for ` +
            `"Hello" and lists ${bare.familyCount} families. That is a machine without the build host's ` +
            'prefix losing ALL text, which is worse than the defect PANGOCAIRO_BACKEND=fc was set to fix — ' +
            'the bundle has to ship `etc/fonts` before it may choose this backend',
    );
    console.log(
        `no fontconfig config: [${bare.mapTypes}], ${bare.familyCount} families, latin=${seen.latin} ` +
            `tamil=${seen.tamil}`,
    );
});

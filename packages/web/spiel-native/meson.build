# GjsifySpiel — libspiel, the Spiel speech-synthesis CLIENT library, shipped as
# ONE relocatable shared library plus its typelib (ADR 0017), so `gi://Spiel` can
# be imported on a host that has no libspiel package.
#
# No C of our own: unlike the sibling bridges here, this build wraps an UPSTREAM
# GNOME library unchanged (LGPL-2.1-or-later, see README.md § License and
# docs/attribution.md). What this file adds is only what makes the upstream build
# shippable as a prebuild — three properties, each measured rather than assumed,
# and each with its own section below:
#
#   1. ONE library, not two (libspeechprovider is linked statically),
#   2. nothing but spiel_* leaves it (version script),
#   3. an UNVERSIONED leaf the typelib names (`libspiel-1.0.so`).
#
# LINUX ONLY, and that is a property of Spiel rather than of this build: a client
# finds its speech providers over the D-Bus SESSION BUS and plays their audio
# through GStreamer. There is no provider protocol on win32 or darwin, so a
# prebuild for them would load and then find nothing, forever. README.md
# § Provider discovery has the measurement.
project('GjsifySpiel', 'c',
    version: '1.0.5',
    meson_version: '>= 1.3.2',
    license: 'LGPL-2.1-or-later',
    # `-Os` WITHOUT `-g`, spelled as the two options rather than as a buildtype,
    # because no buildtype is both: meson's `minsize` carries `debug=true`, and
    # `plain` carries no optimisation at all. The size of this prebuild IS the
    # size of upstream's objects — there is no code of ours to optimise — and a
    # `-g` build would put object-file paths from the CI runner into the shipped
    # image (docs/prebuilds.md § Reproducibility).
    default_options: ['optimization=s', 'debug=false'],
)

fs = import('fs')

if host_machine.system() != 'linux'
    error('@gjsify/spiel-native builds for linux only — Spiel finds its providers on the ' +
          'D-Bus session bus, which exists on no other target (README.md § Provider discovery). ' +
          'This host is ' + host_machine.system() + '.')
endif

# ----------------------------------------------------------------------------
# 2. WHAT LEAVES THE LIBRARY — the version script, delivered GLOBALLY.
#
# This has to be set BEFORE `subproject()`, and it has to be `add_global_link_arguments`
# rather than an option on the subproject. Both halves are measured:
#
#   · `-Dlibspiel:c_link_args=…` is ACCEPTED, stored and echoed back by `meson
#     configure` — and never reaches the linker, because a subproject's
#     `c_link_args` is a per-project option that `shared_library()` in that
#     project does not consume for a target declared without `link_args`.
#     Measured: 89 spiel_* and 7 speech_provider_* exported, i.e. no script.
#   · `LDFLAGS` in the environment does work, and is exactly the kind of fact
#     that is true in one shell and false in the next — `build:prebuilds` would
#     ship a different library depending on who ran it.
#
# A global link argument is neither: it is recorded in the build definition and
# applied to every link in this build tree, subprojects included. Measured with
# this arrangement: 89 spiel_* and 0 speech_provider_*, which is what
# test/check-elf-deps.py reads back from the built file on every run.
# ----------------------------------------------------------------------------
spiel_map = meson.current_source_dir() / 'src' / 'c' / 'spiel.map'
add_global_link_arguments('-Wl,--version-script=' + spiel_map, language: 'c')

# ----------------------------------------------------------------------------
# 1. ONE LIBRARY — libspeechprovider linked STATICALLY into libspiel.
#
# Upstream builds libspeechprovider as a second shared library that libspiel
# links. Shipped that way, a prebuild would be two `.so` files, the second
# findable only through an `$ORIGIN` RUNPATH this build would have to inject
# (upstream sets none) — and a second typelib nobody imports. Static collapses
# all of it: one file, no RUNPATH, no loader-path question for
# `check-prebuild-loader-path.mjs` to answer. `Spiel-1.0.gir` references ZERO
# `speech_provider_*` symbols (measured), so nothing introspectable is lost —
# which is also what makes hiding them above safe.
#
# `introspection=false` on the subproject's subproject for the same reason: a
# `SpeechProvider-1.0.typelib` naming a library that is no longer shipped is a
# broken artifact, and nothing here imports it.
# ----------------------------------------------------------------------------
libspiel = subproject('libspiel',
    default_options: [
        'docs=false',
        'tests=false',
        'utils=false',
        'introspection=true',
        'libspeechprovider:default_library=static',
        'libspeechprovider:introspection=false',
        'libspeechprovider:docs=false',
        'libspeechprovider:tests=false',
    ],
)
spiel_lib = libspiel.get_variable('spiel_lib')
# `gnome.generate_gir()` answers [gir, typelib]; only the GIR is taken, because
# the typelib beside it was compiled from a `shared-library` this package does
# not ship (below).
spiel_gir = libspiel.get_variable('spiel_gir')[0]

# ----------------------------------------------------------------------------
# 3. THE UNVERSIONED LEAF, and why nothing upstream is patched.
#
# meson's `version:` makes `libspiel-1.0.so.1.0.5` with `libspiel-1.0.so.1` and
# `libspiel-1.0.so` as SYMLINKS to it, and records the middle one in the GIR's
# `shared-library`. A prebuild directory is copied file by file by
# `stage-prebuild.mjs` — symlinks become copies — so shipping the chain would
# ship three identical megabytes, and shipping only what the GIR names would ship
# a leaf whose own name says it is one of a set.
#
# So the shipped set is re-derived rather than patched: the real file under a
# plain name, the GIR rewritten to name it, and the typelib recompiled from that
# GIR. The same three steps as gamepad-native/meson.build:238-251, for the same
# reason — the typelib's `shared-library` entry must name a file that is actually
# in the directory beside it.
#
# The ELF SONAME stays `libspiel-1.0.so.1` and that is harmless: a SONAME is what
# the loader records in a DEPENDENT's DT_NEEDED, and nothing here depends on this
# library — girepository opens it by the path the typelib names.
#
# All three land in the TOP-LEVEL build directory on purpose: `stage-prebuild.mjs`
# reads it with a NON-RECURSIVE `readdirSync`, so an artifact in
# `build/subprojects/libspiel/libspiel/` is not shipped at all.
# ----------------------------------------------------------------------------
spiel_so_leaf = 'libspiel-1.0.so'

spiel_so = custom_target(spiel_so_leaf,
    input: spiel_lib,
    output: spiel_so_leaf,
    # `cp` dereferences, so this is the real file even though `@INPUT@` may be
    # the versioned one meson built.
    command: ['cp', '-L', '@INPUT@', '@OUTPUT@'],
    build_by_default: true,
)

sed = find_program('sed')
spiel_gir_relinked = custom_target('Spiel-1.0.gir',
    input: spiel_gir,
    output: 'Spiel-1.0.gir',
    # NO BACKSLASH ESCAPES in this pattern, and that is not laziness: meson
    # rewrites `\\.` in a string literal to `/.` by the time the argument reaches
    # the program (seen in `ninja -t commands`), so the escaped form matches
    # nothing and the rewrite silently does not happen — which is exactly how it
    # failed first. Unescaped `.` matches any character, which over this literal
    # is a distinction without a difference.
    command: [sed, '-e', 's|shared-library="libspiel-1.0.so.1"|shared-library="' + spiel_so_leaf + '"|', '@INPUT@'],
    capture: true,
    build_by_default: true,
)

spiel_typelib = custom_target('Spiel-1.0.typelib',
    input: spiel_gir_relinked,
    output: 'Spiel-1.0.typelib',
    command: [
        find_program('g-ir-compiler', 'gi-compile-repository'),
        '--output', '@OUTPUT@',
        # Belt and braces with the rewrite above: this is the entry girepository
        # reads, and `check-prebuild-loader-path.mjs` asserts the file it names
        # is in the staged directory.
        '--shared-library', spiel_so_leaf,
        '@INPUT@',
    ],
    depends: [spiel_so],
    build_by_default: true,
)

# ----------------------------------------------------------------------------
# Tests — what this build CLAIMS, read back from what it produced.
#
# Nothing here synthesises speech, and that is not caution about CI noise: a
# `speak()` on a developer's machine comes out of their speakers. The gjs leg
# sets a `fakesink` before it touches a Speaker at all (see the file).
# ----------------------------------------------------------------------------
python3 = find_program('python3', required: false)
if python3.found()
    # python3 is `required: false` for the same reason as in gamepad-native: a
    # host without it gets a tree that builds with the test SKIPPED. The BUILD
    # needs python3 regardless (both upstream projects run it), so in practice
    # this only ever skips where nothing built either.
    test('elf-deps', python3,
         args: [files('test/check-elf-deps.py'), spiel_so.full_path()],
         depends: [spiel_so])
endif

gjs = find_program('gjs', required: false)
if gjs.found()
    # The shipped PAIR, through girepository, exactly as a consumer reaches it:
    # the typelib names `libspiel-1.0.so` by bare leaf and finds it beside
    # itself. Both are in this directory only because of the three targets above.
    gi_env = {
        'GI_TYPELIB_PATH': meson.current_build_dir(),
        'LD_LIBRARY_PATH': meson.current_build_dir(),
    }
    test('load-typelib-gjs', gjs,
         args: ['-m', files('test/load-typelib.gjs.js')],
         depends: [spiel_so, spiel_typelib],
         timeout: 60,
         env: gi_env)

    # The live leg, registered always and SKIPPED (exit 77) without
    # GJSIFY_SPIEL_LIVE=1 — see the file for why it cannot be the default: it
    # D-Bus-activates the speech providers of whoever runs it. Registered rather
    # than left out so `meson test --list` shows it exists; a check nobody can
    # see is a check nobody runs.
    test('speak-fakesink-gjs', gjs,
         args: ['-m', files('test/speak-fakesink.gjs.js')],
         depends: [spiel_so, spiel_typelib],
         timeout: 120,
         is_parallel: false,
         env: gi_env)
endif

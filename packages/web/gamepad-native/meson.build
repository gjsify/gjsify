# GjsifyGamepad — SDL3's gamepad subsystem behind a GObject API, the backend of
# @gjsify/gamepad on every OS (ADR 0075 + Amendment 1).
#
# C, not Vala or Objective-C: SDL's API is C, and the one Apple-specific piece
# (draining the main run loop) is CoreFoundation's C API. The same source is
# meant to build on linux and win32; only darwin is wired today, and the per-OS
# differences the other legs need are listed in README.md § Other platforms.
project('GjsifyGamepad', 'c', version: '1.0',
        meson_version: '>= 1.3.0',
        # minsize: SDL is compiled into this library, so its optimisation level
        # IS the prebuild's size. meson hands the build type to SDL's CMake
        # (MinSizeRel), so both halves are built the same way — and because
        # neither half is a `debug` build, neither carries the `-g` that would put
        # an object-mtime debug map into the shipped image. The sibling bridges
        # reach the same property through `buildtype=plain`; see the comment there.
        default_options: ['c_std=c11', 'buildtype=minsize'])

if host_machine.system() != 'darwin'
    error('GjsifyGamepad is wired for darwin only so far. The linux and win32 ' +
          'legs are open work: see README.md § Other platforms.')
endif

gnome = import('gnome')
cmake = import('cmake')

# ----------------------------------------------------------------------------
# SDL3 — statically linked and trimmed to what a gamepad needs (Amendment 1).
#
# Kept: joystick + gamepad, events (the joystick subsystem requires it), haptic,
# sensor (controller gyro/accelerometer) and HIDAPI (SDL's own vendor drivers).
# Everything else is off, which is what keeps the runtime dependencies to the OS:
# Homebrew's full libSDL3 also links AppKit, Metal, AVFoundation, CoreAudio and
# CoreMedia for subsystems a gamepad never uses.
# ----------------------------------------------------------------------------
sdl_options = cmake.subproject_options()
sdl_options.add_cmake_defines({
    'SDL_SHARED': false,
    'SDL_STATIC': true,
    'SDL_TEST_LIBRARY': false,
    'SDL_TESTS': false,
    'SDL_EXAMPLES': false,
    'SDL_INSTALL': false,
    'SDL_JOYSTICK': true,
    'SDL_HAPTIC': true,
    'SDL_SENSOR': true,
    'SDL_HIDAPI': true,
    'SDL_VIDEO': false,
    'SDL_RENDER': false,
    'SDL_GPU': false,
    'SDL_AUDIO': false,
    'SDL_CAMERA': false,
    'SDL_DIALOG': false,
    'SDL_TRAY': false,
    'SDL_POWER': false,
    'SDL_HIDAPI_LIBUSB': false,
    # The static archive is linked into a shared library.
    'CMAKE_POSITION_INDEPENDENT_CODE': true,
})
sdl = cmake.subproject('sdl3', options: sdl_options)
sdl_dep = sdl.dependency('SDL3-static')

dependencies = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
    sdl_dep,
]

# Only the gjsify_gamepad_* API leaves the library. That keeps SDL's own symbols
# private — a second SDL in the same process (an app using SDL for audio) cannot
# collide with this copy — and it is what lets -dead_strip drop every SDL
# function the shim does not reach, which is most of the library's size.
# -S drops the debug map: its N_OSO entries carry object-file mtimes, which made
# otherwise identical darwin builds differ byte for byte (docs/prebuilds.md).
# meson's cmake module does not carry SDL's framework link list (CMake spells it
# as `$<LINK_LIBRARY:FRAMEWORK,…>`, which the module drops), so it is repeated
# here: exactly what the kept subsystems reach. `-dead_strip_dylibs` removes any
# the final link does not use, so this list can only over-state, never add.
frameworks = [
    '-framework', 'CoreFoundation', '-framework', 'Foundation',
    '-framework', 'IOKit', '-framework', 'ForceFeedback',
    '-framework', 'GameController', '-framework', 'CoreHaptics',
    '-framework', 'CoreServices', '-lobjc',
]

link_args = frameworks + [
    '-Wl,-exported_symbol,_gjsify_gamepad_*',
    '-Wl,-dead_strip',
    '-Wl,-dead_strip_dylibs',
    '-Wl,-S',
    # Room for the rpaths stage-prebuild.mjs rewrites; the pad is fixed at link
    # time (docs/prebuilds.md, "larger updated load commands do not fit").
    '-Wl,-headerpad_max_install_names',
]

libgjsifygamepad = library('gjsifygamepad', 'src/c/gjsify-gamepad.c',
    dependencies: dependencies,
    link_args: link_args,
    install: true,
    # The library has to be findable beside its typelib — the requirement
    # check-prebuild-loader-path.mjs enforces on every shipped prebuild.
    install_rpath: '@loader_path',
    build_rpath: '@loader_path',
)

# GIR from the header only: it carries every annotation and doc comment, and the
# .c file has SDL includes the scanner has no reason to parse.
gir = gnome.generate_gir(libgjsifygamepad,
    sources: files('src/c/gjsify-gamepad.h'),
    namespace: 'GjsifyGamepad',
    nsversion: '1.0',
    identifier_prefix: 'GjsifyGamepad',
    symbol_prefix: 'gjsify_gamepad',
    includes: ['GObject-2.0'],
    header: 'gjsify-gamepad.h',
    install: true,
    install_dir_gir: get_option('datadir') / 'gir-1.0',
    install_dir_typelib: get_option('libdir') / 'girepository-1.0',
    extra_args: ['--quiet', '--warn-all'],
)

# ----------------------------------------------------------------------------
# Tests — the zero-device path, which is all a runner without a controller can
# prove: SDL initialises, enumerates nothing, shuts down, and repeated cycles
# leave nothing behind (`leaks`, below, and README.md § Testing).
# ----------------------------------------------------------------------------
lifecycle = executable('monitor-lifecycle', 'test/monitor-lifecycle.c',
    dependencies: [dependency('glib-2.0'), dependency('gobject-2.0')],
    link_with: libgjsifygamepad,
    include_directories: include_directories('src/c'),
)
test('monitor-lifecycle', lifecycle)

# The same lifecycle through the typelib under gjs, i.e. the GIR annotations
# @gjsify/gamepad relies on. The build directory holds both the typelib and the
# library its `shared-library` names.
gjs = find_program('gjs', required: false)
if gjs.found()
    test('monitor-lifecycle-gjs', gjs,
         args: ['-m', files('test/monitor-lifecycle.gjs.js')],
         depends: [libgjsifygamepad, gir],
         env: {
             'GI_TYPELIB_PATH': meson.current_build_dir(),
             'DYLD_LIBRARY_PATH': meson.current_build_dir(),
         })
endif

# The same lifecycle under Node on the @gjsify/node-gi bridge — the runtime a
# `--app node` bundle, and every Windows program, reaches `gi://` through (ADR 0024
# § 4). It is the only leg on a runtime whose girepository is not GJS's, which is what
# makes it worth its own test rather than a claim.
#
# Registered ONLY when the bridge is actually there. `@gjsify/node-gi` is not a
# workspace member (ADR 0005), so nothing BUILDS its addon until
# `npm install` in packages/node-gi/node-gi does; a test that imported it
# unconditionally would red on every tree that has not done that, and a skipped leg
# nobody can see is how the gap came to be open in the first place. The addon paths are
# node-gi's own `nativeCandidates` order (native-paths.js): a staged prebuild, then the
# node-gyp Release and Debug builds.
node = find_program('node', required: false)
fs = import('fs')
node_gi_dir = '../../node-gi/node-gi'
# The ONE target spelling, `${process.platform}-${process.arch}` (AGENTS.md
# § Runtime & platform model) — which meson does not speak: `system()` answers
# `windows` and `cpu_family()` answers `x86_64`/`aarch64`, so the raw pair spells
# `windows-x86_64`/`linux-x86_64` and finds no staged prebuild on any host. This is
# the miss `native-paths.js`'s own header names: a guard that looks in a directory
# the loader does not probe. The aliases mirror `ARCH_ALIASES` in
# packages/infra/manifest-conformance/lib/platforms.mjs; an unmapped family passes
# through so a new one reads as itself rather than as nothing.
node_gi_arch = {
    'x86_64': 'x64',
    'amd64': 'x64',
    'aarch64': 'arm64',
}.get(host_machine.cpu_family(), host_machine.cpu_family())
node_gi_target = (host_machine.system() == 'windows' ? 'win32' : host_machine.system()) + '-' + node_gi_arch
node_gi_addon = [
    node_gi_dir / 'prebuilds' / node_gi_target / 'node_gi.node',
    node_gi_dir / 'build' / 'Release' / 'node_gi.node',
    node_gi_dir / 'build' / 'Debug' / 'node_gi.node',
]
# The question is the ADDON, not the package: node-gi's SOURCES are in every
# checkout, so testing for one of them registered this leg on a tree where
# `require('@gjsify/node-gi')` throws and the test died on its first import.
node_gi_built = false
if node.found()
    foreach candidate : node_gi_addon
        if fs.exists(candidate)
            node_gi_built = true
        endif
    endforeach
endif
if node_gi_built
    # The build directory holds the typelib and the library its `shared-library`
    # names — the same two the gjs leg puts on its path. Nothing else is needed: the
    # addon resolves the host GLib itself, measured on macOS 27 arm64.
    test('monitor-lifecycle-node', node,
         args: [files('test/monitor-lifecycle.node.js')],
         depends: [libgjsifygamepad, gir],
         env: {
             'GI_TYPELIB_PATH': meson.current_build_dir(),
             'DYLD_LIBRARY_PATH': meson.current_build_dir(),
         })
else
    message('node-gi not built — skipping monitor-lifecycle-node (npm install in packages/node-gi/node-gi)')
endif

leaks = find_program('leaks', required: false)
if leaks.found()
    # MallocStackLogging is what lets `leaks` name the allocation site of a
    # leak; --atExit checks the process at the moment it exits normally.
    #
    # The test program is the wrapper, not `leaks` itself, because the wrapper
    # reads the report's verdict while `leaks` may fail to exit at all: Xcode
    # 16.4's `leaks` on the macOS 15 runner answers in ~1.2 s and then hangs
    # until the timeout. That is why this is `0 leaks or red` and not a test of
    # the tool's exit status. The wrapper also FAILS when the report carries no
    # verdict, so it cannot pass by not having run the check — see
    # test/leaks-verdict.sh.
    test('monitor-lifecycle-leaks',
         files('test/leaks-verdict.sh'),
         args: [leaks.full_path(), lifecycle.full_path()],
         depends: lifecycle,
         env: ['MallocStackLogging=1'],
         timeout: 180)
endif

# GjsifyGamepad — SDL3's gamepad subsystem behind a GObject API, the backend of
# @gjsify/gamepad on every OS (ADR 0075 + Amendment 1).
#
# C, not Vala or Objective-C: SDL's API is C, and the one Apple-specific piece
# (draining the main run loop) is CoreFoundation's C API. One source, three
# OSes; what differs per OS is only how the library is linked, below.
project('GjsifyGamepad', 'c', version: '1.0',
        meson_version: '>= 1.3.0',
        # minsize: SDL is compiled into this library, so its optimisation level
        # IS the prebuild's size. meson hands the build type to SDL's CMake
        # (MinSizeRel), so both halves are built the same way. On MSVC it also
        # picks the release CRT (b_vscrt=md), which is the redistributable one.
        default_options: ['c_std=c11', 'buildtype=minsize'])

system = host_machine.system()
is_darwin = system == 'darwin'
is_windows = system == 'windows'
is_linux = system == 'linux'
if not (is_darwin or is_windows or is_linux)
    error('GjsifyGamepad is built for darwin, linux and win32 (ADR 0075). ' +
          system + ' is none of them.')
endif

cc = meson.get_compiler('c')
gnome = import('gnome')
cmake = import('cmake')
fs = import('fs')

# ----------------------------------------------------------------------------
# SDL3 — statically linked and trimmed to what a gamepad needs (Amendment 1).
#
# Kept: joystick + gamepad, events (the joystick subsystem requires it), haptic,
# sensor (controller gyro/accelerometer) and HIDAPI (SDL's own vendor drivers).
# Everything else is off, which is what keeps the runtime dependencies to the OS:
# Homebrew's full libSDL3 also links AppKit, Metal, AVFoundation, CoreAudio and
# CoreMedia for subsystems a gamepad never uses.
# ----------------------------------------------------------------------------
sdl_defines = {
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
}
if is_linux
    sdl_defines += {
        # libudev and libdbus are dlopen()ed by soname at run time, never linked:
        # SDL_DEPS_SHARED is SDL's default and is spelled out because it is what
        # keeps both out of DT_NEEDED. Without libudev at run time SDL watches
        # /dev/input with inotify instead, so a host without udev still sees
        # controllers. Building with them needs only their headers.
        'SDL_DEPS_SHARED': true,
        'SDL_LIBUDEV': true,
        'SDL_DBUS': true,
        # Text input and io_uring have nothing to do with a gamepad.
        'SDL_IBUS': false,
        'SDL_LIBURING': false,
        # SDL refuses to configure on Unix without X11 or Wayland headers, even
        # with SDL_VIDEO off, unless told that no window is wanted — none is.
        'SDL_UNIX_CONSOLE_BUILD': true,
    }
endif
if is_windows
    # THE DIRECTINPUT DECISION. SDL checks for <dinput.h> only inside
    # `if(SDL_DIRECTX)`, and SDL_DIRECTX depends on SDL_AUDIO OR SDL_VIDEO — both
    # off here. Left alone, the DirectInput joystick driver and the DirectInput
    # haptic driver would compile out WITHOUT A WORD, leaving XInput, HIDAPI,
    # RawInput and WGI. That loses every generic HID gamepad that is neither an
    # XInput device nor one of HIDAPI's vendor controllers (cheap USB pads,
    # arcade sticks, most adapters) — on Windows those are DirectInput's. The
    # header is part of every Windows SDK and dinput8.dll ships with every
    # Windows, so keeping it adds no dependency beyond the OS: the check's answer
    # is supplied instead of skipped.
    sdl_defines += {'HAVE_DINPUT_H': '1'}
endif

sdl_options = cmake.subproject_options()
sdl_options.add_cmake_defines(sdl_defines)
if is_linux
    # Lets --gc-sections (below) drop the SDL functions the shim never reaches,
    # the ELF counterpart of darwin's -dead_strip.
    sdl_options.append_compile_args('c', ['-ffunction-sections', '-fdata-sections'])
endif
sdl = cmake.subproject('sdl3', options: sdl_options)
sdl_dep = sdl.dependency('SDL3-static')

dependencies = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
    sdl_dep,
]

# meson's cmake module drops SDL's own link list on every OS (on darwin CMake
# spells it `$<LINK_LIBRARY:FRAMEWORK,…>`; elsewhere the module simply does not
# forward it), so what the kept subsystems reach is named here. That doubles as
# a guard: re-enabling a trimmed subsystem fails the link instead of quietly
# adding a runtime dependency.
c_args = ['-DGJSIFY_GAMEPAD_COMPILATION']
link_args = []
if is_darwin
    # Only the gjsify_gamepad_* API leaves the library. That keeps SDL's own
    # symbols private — a second SDL in the same process (an app using SDL for
    # audio) cannot collide with this copy — and it is what lets -dead_strip drop
    # every SDL function the shim does not reach, which is most of the size.
    # -S drops the debug map: its N_OSO entries carry object-file mtimes, which
    # made otherwise identical darwin builds differ byte for byte
    # (docs/prebuilds.md). `-dead_strip_dylibs` removes any framework the final
    # link does not use, so the list can only over-state, never add.
    link_args += [
        '-framework', 'CoreFoundation', '-framework', 'Foundation',
        '-framework', 'IOKit', '-framework', 'ForceFeedback',
        '-framework', 'GameController', '-framework', 'CoreHaptics',
        '-framework', 'CoreServices', '-lobjc',
        '-Wl,-exported_symbol,_gjsify_gamepad_*',
        '-Wl,-dead_strip',
        '-Wl,-dead_strip_dylibs',
        '-Wl,-S',
        # Room for the rpaths stage-prebuild.mjs rewrites; the pad is fixed at
        # link time (docs/prebuilds.md, "larger updated load commands do not fit").
        '-Wl,-headerpad_max_install_names',
    ]
elif is_linux
    # ELF has ONE flat symbol namespace, so hiding SDL is not optional here: an
    # exported SDL_Init in this library would interpose on (or be interposed by)
    # any other SDL the process loads. --exclude-libs makes everything from the
    # static archive local, and the version script exports the API and nothing
    # else — test/check-elf-exports.py reads both back from the built file.
    version_script = meson.current_source_dir() / 'src' / 'c' / 'gjsify-gamepad.map'
    dependencies += [
        cc.find_library('m'),
        cc.find_library('dl', required: false),
        dependency('threads'),
    ]
    link_args += [
        '-Wl,--exclude-libs,ALL',
        '-Wl,--version-script=' + version_script,
        '-Wl,--gc-sections',
        '-Wl,--as-needed',
        '-Wl,--strip-debug',
    ]
    c_args += ['-ffunction-sections', '-fdata-sections']
else
    # Every one of these is an OS DLL; `dumpbin /dependents` on the result is
    # asserted in CI to name nothing else. SDL's own list (CMakeLists.txt,
    # `sdl_link_dependency(base …)` + `joystick … dinput8`). MSVC imports a DLL
    # only when a symbol from it is referenced, so an entry the kept subsystems
    # never reach costs nothing.
    foreach lib : ['kernel32', 'user32', 'gdi32', 'winmm', 'imm32', 'ole32', 'oleaut32',
                   'version', 'uuid', 'advapi32', 'setupapi', 'shell32', 'cfgmgr32',
                   'hid', 'dinput8']
        dependencies += cc.find_library(lib)
    endforeach
endif

# The library has to be findable beside its typelib — the requirement
# check-prebuild-loader-path.mjs enforces on every shipped prebuild. A PE DLL has
# no rpath; Windows looks in the directory of the module that loads it.
rpath = ''
if is_darwin
    rpath = '@loader_path'
elif is_linux
    rpath = '$ORIGIN'
endif

libgjsifygamepad = library('gjsifygamepad', 'src/c/gjsify-gamepad.c',
    dependencies: dependencies,
    c_args: c_args,
    link_args: link_args,
    link_depends: is_linux ? files('src/c/gjsify-gamepad.map') : [],
    install: true,
    install_rpath: rpath,
    build_rpath: rpath,
)

if is_windows
    # g-ir-scanner does not merely parse the header: it builds and RUNS a dumper
    # linked against the library, which is where the `device-added` /
    # `device-removed` signals come from. That is a Linux job of the same CI run
    # (webview2-native's arrangement), and this build compiles the result beside
    # the real DLL, recording the leaf meson actually produced.
    prebuilt_gir = get_option('prebuilt_gir')
    if prebuilt_gir == ''
        error('-Dprebuilt_gir=<dir holding GjsifyGamepad-1.0.gir> is required on win32; ' +
              'the GIR is scanned on Linux (see prebuilds.yml).')
    endif
    gir_file = configure_file(input: prebuilt_gir / 'GjsifyGamepad-1.0.gir',
                              output: 'GjsifyGamepad-1.0.gir', copy: true)
    gir = custom_target('GjsifyGamepad-1.0.typelib',
        input: gir_file,
        output: 'GjsifyGamepad-1.0.typelib',
        command: [
            find_program('g-ir-compiler', 'gi-compile-repository'),
            '--output', '@OUTPUT@',
            '--shared-library', fs.name(libgjsifygamepad.full_path()),
            '@INPUT@',
        ],
        depends: libgjsifygamepad,
        install: true,
        install_dir: get_option('libdir') / 'girepository-1.0',
        build_by_default: true,
    )
else
    # GIR from the header only: it carries every annotation and doc comment, and
    # the .c file has SDL includes the scanner has no reason to parse.
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
endif

# ----------------------------------------------------------------------------
# Tests — the zero-device path, which is all a runner without a controller can
# prove: SDL initialises, enumerates nothing, shuts down, and repeated cycles
# leave nothing behind (`leaks` / valgrind, below, and README.md § Testing).
# Linux adds a virtual controller through uinput, and a read-back of what the
# library links and exports; win32 adds the message-queue measurement.
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
             'LD_LIBRARY_PATH': meson.current_build_dir(),
         })
endif

leaks = find_program('leaks', required: false)
if leaks.found()
    # MallocStackLogging is what lets `leaks` name the allocation site of a
    # leak; --atExit checks the process at the moment it exits normally.
    test('monitor-lifecycle-leaks', leaks,
         args: ['--atExit', '--', lifecycle.full_path()],
         depends: lifecycle,
         env: ['MallocStackLogging=1'],
         timeout: 120)
endif

if is_linux
    # The same C lifecycle under memcheck, run at 1 and at 20 cycles: nothing
    # lost, and nothing reachable that grows with the count (see the script for
    # why reachable memory is compared rather than required to be zero).
    valgrind = find_program('valgrind', required: false)
    if valgrind.found()
        valgrind_args = [files('test/valgrind-growth.py'), valgrind.full_path(), lifecycle.full_path()]
        glib_supp = dependency('glib-2.0').get_variable(pkgconfig: 'prefix') / 'share' / 'glib-2.0' / 'valgrind' / 'glib.supp'
        if fs.exists(glib_supp)
            valgrind_args += [glib_supp]
        endif
        test('monitor-lifecycle-valgrind', find_program('python3'),
             args: valgrind_args,
             depends: lifecycle,
             timeout: 300)
    endif

    test('elf-deps', find_program('python3'),
         args: [files('test/check-elf-deps.py'), libgjsifygamepad.full_path()],
         depends: libgjsifygamepad)

    uinput_pad = executable('uinput-pad', 'test/uinput-pad.c',
        dependencies: [dependency('glib-2.0'), dependency('gobject-2.0')],
        link_with: libgjsifygamepad,
        include_directories: include_directories('src/c'),
    )
    # Exit 77 (skip) without a writable /dev/uinput; CI sets
    # GJSIFY_GAMEPAD_REQUIRE_UINPUT=1 where it provisions one. Not parallel: the
    # virtual pad is a real device for the whole host, so every other test here
    # (which asserts ZERO devices) would see it.
    test('uinput-pad', uinput_pad, timeout: 60, is_parallel: false)
endif

if is_windows
    # Whether SDL needs this thread's message queue pumped in a process whose
    # loop is GLib's (which pumps none): the windows and threads the shim adds
    # and the messages that pile up with nobody dispatching them. See the file.
    message_queue = executable('win32-message-queue', 'test/win32-message-queue.c',
        dependencies: [dependency('glib-2.0'), dependency('gobject-2.0')],
        link_with: libgjsifygamepad,
        include_directories: include_directories('src/c'),
    )
    test('win32-message-queue', message_queue, timeout: 120, is_parallel: false)
endif

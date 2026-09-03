# GjsifyWebView2 — the win32 backend for @gjsify/iframe (ADR 0035).
#
# TWO BUILDS, ONE DESCRIPTION, and the split is not "Windows vs the rest" — it is
# "who has which tool", the same axis `@gjsify/webgl`'s win32 build is split on:
#
#   • On win32 this compiles the shipping library (portable C + the WebView2 C++)
#     and turns an IMPORTED GIR into `WebKit-6.0.typelib`. It does not scan.
#   • Everywhere else it compiles the portable C against the unsupported backend
#     and RUNS `g-ir-scanner` over the header. That produces the GIR — including
#     the signals and properties only a dumper run can see — and is the only
#     thing that build is for. Nothing it emits is ever staged: `win32-x64` is
#     the package's one declared target, so `stage-prebuild.mjs` refuses any
#     other host by construction.
#
# A second meson.build for the second half was the alternative and is the one
# this repo has already rejected once, in the same place: a description only the
# platform that uses it exercises drifts from the one CI reads on every PR, and
# nobody finds out until somebody dispatches the other job.
#
# `c_std` is deliberately NOT preset, and that is a measured decision rather than
# an omission: `@gjsify/webgl`'s win32 leg found MSVC's default C mode to be its
# most permissive, and pinning a standard there answers a question this source
# does not ask. Every other host gets its compiler's default, which is at least
# C17.
project('GjsifyWebView2', ['c'], version: '1.0')

gnome = import('gnome')
fs = import('fs')

is_windows = host_machine.system() == 'windows'

if is_windows
    # C++ only where there is C++ to compile. `add_languages` in the branch keeps
    # a Linux scanner build from demanding a C++ toolchain it has no use for.
    add_languages('cpp', native: false)
endif

dependencies = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
    dependency('gio-2.0'),
    dependency('gtk4'),
]

sources = files('src/c/gjsify-webview2.c')
headers = files('src/c/gjsify-webview2.h')

# `src/cpp/gjsify-webview2-win32.cpp` includes `"gjsify-webview2-backend.h"`, which
# lives in `src/c/`. A quoted include searches the INCLUDING file's directory
# first and the target's include path after that, so without this the seam header
# is unreachable from `src/cpp/` on every compiler — and the failure is win32-only
# because `src/cpp/` is the one translation unit no other host compiles. Measured:
# MSVC C1083 on the first Windows run of this package, after the Fedora job that
# compiles the portable half had gone green.
include_dirs = include_directories('src/c')

link_args = []
cpp_args = []

if is_windows
    sources += files('src/cpp/gjsify-webview2-win32.cpp')

    # The WebView2 SDK is a NuGet package and nothing else — there is no system
    # location for it and no pkg-config file, so the caller passes the extracted
    # `build/native` directory and this reads the two paths out of it. Pinned by
    # the workflow, like every other version in this repo: an unpinned SDK makes
    # two builds of one commit two different artifacts.
    webview2_sdk = get_option('webview2_sdk')
    if webview2_sdk == ''
        error('-Dwebview2_sdk=<the NuGet package\'s build/native directory> is required on ' +
              'win32. It supplies WebView2.h and WebView2LoaderStatic.lib, neither of which ' +
              'has a system location.')
    endif

    cpp_args += ['-I' + webview2_sdk / 'include']
    # The STATIC loader, deliberately: the alternative ships a second
    # WebView2Loader.dll inside the tarball, and every consumer of this prebuild
    # already has the Evergreen runtime the loader is looking for. One fewer
    # file whose absence reads as "the specified module could not be found"
    # naming the DEPENDENT rather than the dependency.
    link_args += [
        webview2_sdk / 'x64' / 'WebView2LoaderStatic.lib',
        # WebView2LoaderStatic's own dependencies. Naming them here rather than
        # letting the link fail with four unresolved externals that look like
        # our code's.
        'version.lib',
        'shlwapi.lib',
        'ole32.lib',
        'oleaut32.lib',
        'user32.lib',
        'advapi32.lib',
    ]
else
    sources += files('src/c/gjsify-webview2-unsupported.c')
endif

# MSVC exports NOTHING from a DLL on its own, so the symbol list is a file rather
# than a property of the source — see the header of `gjsifywebview2.def`. Passed
# through `kwargs:` because the option is meaningless to every other linker and a
# `.def` handed to GCC is a link input rather than an export list.
library_kwargs = {}
if is_windows
    library_kwargs += {'vs_module_defs': 'gjsifywebview2.def'}
endif

libgjsifywebview2 = library('gjsifywebview2', sources,
    dependencies: dependencies,
    include_directories: include_dirs,
    cpp_args: cpp_args,
    link_args: link_args,
    install: true,
    kwargs: library_kwargs,
    # PE has no rpath; ELF does, and it is the same requirement
    # `check-prebuild-loader-path.mjs` enforces on every shipped prebuild — the
    # library has to be findable beside its typelib. Only the win32 artifact
    # ships, so this is here for the scanner build's own load.
    install_rpath: is_windows ? '' : '$ORIGIN',
    build_rpath: is_windows ? '' : '$ORIGIN',
)

# ----------------------------------------------------------------------------
# The GIR, and the typelib.
#
# The namespace IS `WebKit` 6.0 while the C symbols stay `gjsify_webview2_*` —
# GIR's namespace name and its identifier/symbol prefixes are independent knobs.
# That is what lets `@gjsify/iframe` keep `import WebKit from
# 'gi://WebKit?version=6.0'` verbatim on all three operating systems and carry NO
# backend seam at all: which typelib answers to that name is decided by what is
# on GI_TYPELIB_PATH, i.e. by packaging.
#
# ADR 0022 § One namespace records why the tidier-sounding option (a distinct
# namespace plus a seam module) is not available: ESM `gi://` has no synchronous
# form, the seam needs a top-level await, and `@gjsify/unit` deadlocks on a
# nested main loop before its first test.
#
# g-ir-scanner has no C++ front end any more than it has an Objective-C one, so
# `sources:` is the HEADER ONLY and the header is pure C. What is not in the
# header does not reach the GIR, and what does not reach the GIR is missing in
# GJS.
# ----------------------------------------------------------------------------
gir_namespace = 'WebKit'
gir_nsversion = '6.0'
gir_name = gir_namespace + '-' + gir_nsversion

if is_windows
    prebuilt_gir = get_option('prebuilt_gir')
    if prebuilt_gir == ''
        error('-Dprebuilt_gir=<dir holding ' + gir_name + '.gir> is required on win32. ' +
              'g-ir-scanner builds and RUNS a dumper against the library to read the GType ' +
              'hierarchy, the signals and the properties; the GIR is therefore produced by ' +
              'the Fedora job of the same CI run and compiled here.')
    endif

    gir_compiler = find_program('g-ir-compiler', 'gi-compile-repository')

    # `fs.name(...full_path())` rather than a `host_machine` branch: MSVC names
    # the import target `gjsifywebview2.dll` and MinGW `libgjsifywebview2.dll`,
    # and a typelib recording the wrong leaf is FOUND via GI_TYPELIB_PATH and
    # then never loads — the silent failure the CI step after this asserts
    # against.
    custom_target(gir_name + '.typelib',
        input: prebuilt_gir / gir_name + '.gir',
        output: gir_name + '.typelib',
        command: [
            gir_compiler,
            '--output', '@OUTPUT@',
            '--shared-library', fs.name(libgjsifywebview2.full_path()),
            '@INPUT@',
        ],
        depends: libgjsifywebview2,
        install: true,
        install_dir: get_option('libdir') / 'girepository-1.0',
        build_by_default: true,
    )
else
    gnome.generate_gir(libgjsifywebview2,
        sources: headers,
        namespace: gir_namespace,
        nsversion: gir_nsversion,
        identifier_prefix: 'GjsifyWebView2',
        symbol_prefix: 'gjsify_webview2',
        includes: ['GObject-2.0', 'Gio-2.0', 'Gtk-4.0', 'Gdk-4.0'],
        header: 'gjsify-webview2.h',
        install: true,
        install_dir_gir: get_option('datadir') / 'gir-1.0',
        install_dir_typelib: get_option('libdir') / 'girepository-1.0',
        extra_args: ['--quiet', '--warn-all'],
    )
endif

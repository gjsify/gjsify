# GjsifyWebKit — the darwin backend for @gjsify/iframe (ADR 0022).
#
# Objective-C, not Vala: the sibling bridges in this repo (gwebgl, gjsify-http2)
# bind portable C libraries, whereas this one binds an Apple framework, and
# WKWebView's API is reachable only from Objective-C. That is also why the
# language list is not conditional the way gwebgl's is — there is no host for
# this package that lacks clang, because there is no host for it that is not
# macOS.
project('GjsifyWebKit', ['c', 'objc'], version: '1.0',
        default_options: ['c_std=c11'])

if host_machine.system() != 'darwin'
    error('GjsifyWebKit binds Apple WebKit and only builds on darwin. ' +
          'On Linux, @gjsify/iframe uses gi://WebKit 6.0 directly.')
endif

# CI reaches this file only through prebuilds.yml's `build-prebuilds-macos` job,
# which is opt-in behind the `ci:macos` PR label (macOS runners bill at 10x).
# Unlabelled, every darwin leg skips and this package is never compiled — see
# README.md § Building for why that can hide behind a green PR.

gnome = import('gnome')
fs = import('fs')

root_dir = meson.current_source_dir()

dependencies = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
    dependency('gio-2.0'),
    dependency('gtk4'),
]

# `-fobjc-arc` is what makes the CFBridgingRetain/CFRelease pairs in the
# implementation mean what they say: under ARC those are the explicit
# hand-offs between ObjC's ownership and GObject's, and without it they are
# double-frees waiting to happen.
add_project_arguments(['-fobjc-arc'], language: 'objc')

frameworks = ['-framework', 'Cocoa', '-framework', 'WebKit', '-framework', 'CoreGraphics']

sources = files('src/objc/gjsify-webkit.m')
headers = files('src/objc/gjsify-webkit.h')

libgjsifywebkit = library('gjsifywebkit', sources,
    dependencies: dependencies,
    link_args: frameworks,
    install: true,
    # The Vala bridges get this from valac; here it is explicit. It is the same
    # requirement `check-prebuild-loader-path.mjs` enforces on every shipped
    # prebuild: the library has to be findable beside its typelib.
    install_rpath: '@loader_path',
    build_rpath: '@loader_path',
)

# ----------------------------------------------------------------------------
# GIR — scanned from the HEADER ONLY, deliberately.
#
# g-ir-scanner runs the C preprocessor and parses C declarations. It has no
# Objective-C front end, so handing it `gjsify-webkit.m` fails on the first
# `@interface`. That constraint is the reason the header carries every doc
# comment and every (transfer)/(nullable) annotation: what is not in the header
# does not reach the GIR, and what does not reach the GIR is wrong or missing
# in GJS.
# ----------------------------------------------------------------------------
gir = gnome.generate_gir(libgjsifywebkit,
    sources: headers,
    # The namespace IS `WebKit` 6.0, while the C symbols stay `gjsify_webkit_*`
    # — GIR's namespace name and its identifier/symbol prefixes are independent
    # knobs. This is what lets `@gjsify/iframe` keep `import WebKit from
    # 'gi://WebKit?version=6.0'` verbatim on both platforms and carry NO backend
    # seam at all: which typelib answers to that name is decided by what is on
    # GI_TYPELIB_PATH, i.e. by packaging, not by a branch in shipping source.
    #
    # The alternative (a distinct `GjsifyWebKit` namespace plus a seam module)
    # was built first and measured unworkable: ESM `gi://` has no synchronous
    # form, so the seam needs a top-level await, which makes the whole
    # `@gjsify/iframe` module graph async — and `@gjsify/unit` blocks on a
    # nested main loop during start-up, so the suite deadlocks before its first
    # test. docs/poc/webkit-runloop-darwin.m records the measurement.
    namespace: 'WebKit',
    nsversion: '6.0',
    identifier_prefix: 'GjsifyWebKit',
    symbol_prefix: 'gjsify_webkit',
    includes: ['GObject-2.0', 'Gio-2.0', 'Gtk-4.0', 'Gdk-4.0'],
    header: 'gjsify-webkit.h',
    install: true,
    install_dir_gir: get_option('datadir') / 'gir-1.0',
    install_dir_typelib: get_option('libdir') / 'girepository-1.0',
    extra_args: ['--quiet', '--warn-all'],
)

# SPDX-License-Identifier: MIT
# @gjsify/napi — N-API host shim over GJS's SpiderMonkey (mozjs-140).
# Mirrors the @gjsify/tls-native meson pipeline: Vala (GI surface) + native
# code compiled into ONE shared library + GIR + typelib. The native part here
# is C++ (JSAPI is C++); the shim is intrinsically pinned to GJS's mozjs
# major and must be rebuilt when GJS bumps (ADR 0011).
project('GjsifyNapi', ['c', 'cpp', 'vala'],
    version: '1.0',
    # Match GJS's own build (refs/gjs/meson.build): C++17, no RTTI, no
    # exceptions — mozjs-140 has no stable C++ ABI and is built the same way.
    default_options: ['cpp_std=c++17'])

dependencies = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
    dependency('gio-2.0'),
    dependency('gjs-1.0'),      # gjs_context_get_current / get_native_context
    dependency('mozjs-140'),    # JSAPI
]

cc = meson.get_compiler('c')
dl_dep = cc.find_library('dl', required: false)  # dlopen/dlsym/dladdr
if dl_dep.found()
    dependencies += dl_dep
endif

vala_sources = files(
    'src/vala/napi.vala',
)

# node-gi TU-split idiom: one common.h owning cross-TU decls, functional
# .cc slices. The vendored Node-API headers live in src/napi-headers/.
cc_sources = files(
    'src/cc/env.cc',
    'src/cc/error.cc',
    'src/cc/function.cc',
    'src/cc/module.cc',
    'src/cc/object.cc',
    'src/cc/stubs.cc',
    'src/cc/value.cc',
)

# §3b export hygiene: only napi_*/node_api_* (the ABI) + gjsify_napi_* (the
# GI/Vala surface) are visible; everything else is local.
version_script = meson.current_source_dir() / 'src/cc/napi.export.map'

libGjsifyNapi = library('gjsifynapi', vala_sources + cc_sources,
    dependencies: dependencies,
    include_directories: include_directories('src/napi-headers'),
    cpp_args: [
        '-fno-rtti',
        '-fno-exceptions',
    ],
    # Stub vapis for the C++-only deps (mozjs-140, gjs-1.0): meson forwards
    # every dependency() to valac as --pkg; Vala itself never uses them.
    vala_args: [
        '--vapidir=' + meson.current_source_dir() / 'src/vala',
    ],
    link_args: [
        '-Wl,--version-script,' + version_script,
    ],
    link_depends: files('src/cc/napi.export.map'),
    vala_gir: meson.project_name() + '-1.0.gir',
    install: true,
    install_dir: [true, true, true, true],
)

g_ir_compiler = find_program('g-ir-compiler')

custom_target(meson.project_name() + '-1.0.typelib',
    command: [
        g_ir_compiler,
        '--shared-library', 'libgjsifynapi.so',
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-1.0.gir',
    ],
    output: meson.project_name() + '-1.0.typelib',
    depends: libGjsifyNapi,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

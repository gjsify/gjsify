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
    'src/cc/arraybuffer.cc',
    'src/cc/async_work.cc',
    'src/cc/env.cc',
    'src/cc/error.cc',
    'src/cc/function.cc',
    'src/cc/module.cc',
    'src/cc/object.cc',
    'src/cc/ref.cc',
    'src/cc/stubs.cc',
    'src/cc/tsfn.cc',
    'src/cc/value.cc',
    'src/cc/wrap.cc',
)

# §3b export hygiene: only napi_*/node_api_* (the ABI) + gjsify_napi_* (the
# GI/Vala surface) are visible; everything else is local. The mechanism is
# linker-specific, so branch on the host toolchain:
#   - GNU ld / lld (Linux): --version-script (glob patterns, ABI-only export)
#   - ld64 (macOS):         -exported_symbols_list (leading-underscore globs)
# MSVC link.exe (Windows) would need a .def EXPORTS file, but the shim has no
# viable Windows toolchain (no prebuilt MSVC mozjs-140 + gjs — see STATUS.md
# "N-API host in GJS" cross-platform prebuilds), so only linux/darwin branch.
host_system = host_machine.system()
if host_system == 'darwin'
    export_symbols = meson.current_source_dir() / 'src/cc/napi.exported-symbols.txt'
    export_link_args = ['-Wl,-exported_symbols_list,' + export_symbols]
    export_link_depends = files('src/cc/napi.exported-symbols.txt')
    # meson names the shared library libgjsifynapi.dylib on macOS; the typelib
    # must record that exact leaf so gjs' g_module_open resolves it at load.
    shared_lib_name = 'libgjsifynapi.dylib'
else
    version_script = meson.current_source_dir() / 'src/cc/napi.export.map'
    export_link_args = ['-Wl,--version-script,' + version_script]
    export_link_depends = files('src/cc/napi.export.map')
    shared_lib_name = 'libgjsifynapi.so'
endif

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
    link_args: export_link_args,
    link_depends: export_link_depends,
    vala_gir: meson.project_name() + '-1.0.gir',
    install: true,
    install_dir: [true, true, true, true],
)

g_ir_compiler = find_program('g-ir-compiler')

custom_target(meson.project_name() + '-1.0.typelib',
    command: [
        g_ir_compiler,
        '--shared-library', shared_lib_name,
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-1.0.gir',
    ],
    output: meson.project_name() + '-1.0.typelib',
    depends: libGjsifyNapi,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

project('GjsifyHttpSoupBridge', ['c', 'vala'], version: '1.0')

root_dir = meson.current_source_dir()

dependencies = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
    dependency('gio-2.0'),
    dependency('libsoup-3.0', version: '>=3.6'),
]

sources = files(
    'src/vala/peer-close-watch.vala',
    'src/vala/response.vala',
    'src/vala/request.vala',
    'src/vala/server.vala',
)

libGjsifyHttpSoupBridge = library('gjsifyhttpsoupbridge', sources,
    dependencies: dependencies,
    vala_gir: meson.project_name() + '-1.0.gir',
    install: true,
    install_dir: [true, true, true, true],
)

# ----------------------------------------------------------------------------
# Host-dependent shared-library leaf name.
#
# The typelib records the exact filename gjs' g_module_open() resolves at load
# time, and meson names the shared library per host convention: lib<name>.so on
# ELF hosts, lib<name>.dylib on macOS. Recording the wrong leaf yields a typelib
# that IS found via GI_TYPELIB_PATH but whose library never loads — a silent,
# confusing failure. Mirrors the branch in packages/napi/napi/meson.build.
#
# Windows is deliberately absent: this bridge has had no Windows portability
# work, so `else` (ELF naming) is the honest fallback rather than a .dll branch
# that would imply support which does not exist.
# ----------------------------------------------------------------------------
host_system = host_machine.system()
if host_system == 'darwin'
    shared_lib_name = 'libgjsifyhttpsoupbridge.dylib'
else
    shared_lib_name = 'libgjsifyhttpsoupbridge.so'
endif

g_ir_compiler = find_program('g-ir-compiler')

custom_target(meson.project_name() + '-1.0.typelib',
    command: [
        g_ir_compiler,
        '--shared-library', shared_lib_name,
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-1.0.gir',
    ],
    output: meson.project_name() + '-1.0.typelib',
    depends: libGjsifyHttpSoupBridge,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

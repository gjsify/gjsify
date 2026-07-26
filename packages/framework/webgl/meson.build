project('Gwebgl', ['c', 'vala'], version: '0.1')

root_dir = meson.current_source_dir()

vapi_dir = root_dir / 'src/vapi'

add_project_arguments(
    [
        '--vapidir', vapi_dir,
    ],
    language: 'vala'
)

dependencies = [ dependency('glib-2.0'), dependency('gobject-2.0'), dependency('gdk-pixbuf-2.0'), dependency('gtk4'), dependency('epoxy')]

sources = files('src/vala/handle-types.vala', 'src/vala/webgl-rendering-context-base.vala', 'src/vala/webgl-rendering-context.vala', 'src/vala/webgl2-rendering-context.vala')

libGwebgl = library('gwebgl', sources,
    dependencies: dependencies,
    vala_gir:  meson.project_name() + '-0.1.gir',
    install: true,
    install_dir: [true, true, true, true]
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
    shared_lib_name = 'libgwebgl.dylib'
else
    shared_lib_name = 'libgwebgl.so'
endif

g_ir_compiler = find_program('g-ir-compiler')


# TODO not working if gwebgl-0.1.gir not exists
custom_target(meson.project_name() + '-0.1.typelib', command: [g_ir_compiler, '--shared-library', shared_lib_name, '--output', '@OUTPUT@', meson.current_build_dir() / meson.project_name() + '-0.1.gir'],
              #input: meson.current_build_dir() / meson.project_name() + '-0.1.gir',
              output: meson.project_name() +'-0.1.typelib',
              depends: libGwebgl,
              install: true,
              install_dir: get_option('libdir') / 'girepository-1.0')


# Test app
test_sources = files('src/vala/handle-types.vala', 'src/vala/webgl-rendering-context-base.vala', 'src/vala/webgl-rendering-context.vala', 'src/test/app.vala')
executable('gwebgl_vala_app', test_sources, dependencies: dependencies)
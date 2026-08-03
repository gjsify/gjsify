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
# The shared-library leaf name the typelib records — ASKED, not predicted.
#
# g-ir-compiler bakes this string into the typelib and it is exactly what
# g_module_open() resolves at load time, so getting it wrong yields a typelib
# that IS found via GI_TYPELIB_PATH but whose library never loads: a silent
# failure that looks like a broken rpath.
#
# This used to be an `if host_machine.system() == 'darwin'` chain with an ELF
# fallback, and the chain was the problem rather than any single branch. It has
# to predict a filename meson has ALREADY decided, and the mapping is not a
# function of the OS alone — on Windows the same `library()` is `gwebgl.dll`
# under MSVC and `libgwebgl.dll` under MinGW, so an OS branch cannot be right
# for both. Reading the name back off the target is correct by construction for
# every host and toolchain, including ones nobody has tried yet, and it removes
# the one thing a Windows port would otherwise have had to guess.
# ----------------------------------------------------------------------------
fs = import('fs')
shared_lib_name = fs.name(libGwebgl.full_path())

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
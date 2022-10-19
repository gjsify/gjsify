project('Gwebgl', ['c', 'vala'], version: '0.1')

root_dir = meson.current_source_dir()

vapi_dir = root_dir / 'src/vapi'

add_project_arguments(
    [
        '--vapidir', vapi_dir,
    ],
    language: 'vala'
)

dependencies = [ dependency('glib-2.0'), dependency('gobject-2.0'), dependency('gdk-pixbuf-2.0'), dependency('epoxy')]

sources = files('src/vala/handle-types.vala', 'src/vala/webgl-rendering-context-base.vala', 'src/vala/webgl-rendering-context.vala')

libGwebgl = library('gwebgl', sources,
    dependencies: dependencies,
    vala_gir:  meson.project_name() + '-0.1.gir',
    install: true,
    install_dir: [true, true, true, true]
)

g_ir_compiler = find_program('g-ir-compiler')


# TODO not working if gwebgl-0.1.gir not exists
custom_target(meson.project_name() + '-0.1.typelib', command: [g_ir_compiler, '--shared-library', 'libgwebgl.so', '--output', '@OUTPUT@', meson.current_build_dir() / meson.project_name() + '-0.1.gir'],
              #input: meson.current_build_dir() / meson.project_name() + '-0.1.gir',
              output: meson.project_name() +'-0.1.typelib',
              depends: libGwebgl,
              install: true,
              install_dir: get_option('libdir') / 'girepository-1.0')
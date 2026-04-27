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

g_ir_compiler = find_program('g-ir-compiler')

custom_target(meson.project_name() + '-1.0.typelib',
    command: [
        g_ir_compiler,
        '--shared-library', 'libgjsifyhttpsoupbridge.so',
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-1.0.gir',
    ],
    output: meson.project_name() + '-1.0.typelib',
    depends: libGjsifyHttpSoupBridge,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

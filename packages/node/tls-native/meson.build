project('GjsifyTls', ['c', 'vala'], version: '1.0')

root_dir = meson.current_source_dir()

dependencies = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
    dependency('gnutls'),
]

sources = files(
    'src/vala/tls.vala',
)

libGjsifyTls = library('gjsifytls', sources,
    dependencies: dependencies,
    vala_args: ['--pkg=gnutls', '--vapidir=' + meson.current_source_dir() / 'src/vala', '--pkg=gnutls-ocsp'],
    vala_gir: meson.project_name() + '-1.0.gir',
    install: true,
    install_dir: [true, true, true, true],
)

g_ir_compiler = find_program('g-ir-compiler')

custom_target(meson.project_name() + '-1.0.typelib',
    command: [
        g_ir_compiler,
        '--shared-library', 'libgjsifytls.so',
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-1.0.gir',
    ],
    output: meson.project_name() + '-1.0.typelib',
    depends: libGjsifyTls,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

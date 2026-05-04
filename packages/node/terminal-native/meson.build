project('GjsifyTerminal', ['c', 'vala'], version: '1.0')

root_dir = meson.current_source_dir()

dependencies = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
]

sources = files(
    'src/vala/terminal.vala',
)

libGjsifyTerminal = library('gjsifyterminal', sources,
    dependencies: dependencies,
    vala_args: ['--pkg=linux', '--pkg=posix'],
    vala_gir: meson.project_name() + '-1.0.gir',
    install: true,
    install_dir: [true, true, true, true],
)

g_ir_compiler = find_program('g-ir-compiler')

custom_target(meson.project_name() + '-1.0.typelib',
    command: [
        g_ir_compiler,
        '--shared-library', 'libgjsifyterminal.so',
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-1.0.gir',
    ],
    output: meson.project_name() + '-1.0.typelib',
    depends: libGjsifyTerminal,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

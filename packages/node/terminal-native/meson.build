project('GjsifyTerminal', ['c', 'vala'], version: '1.0')

root_dir = meson.current_source_dir()

dependencies = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
]

sources = files(
    'src/vala/terminal.vala',
)

# `--pkg=linux` is deliberately NOT used: the only two symbols this bridge
# needed from Vala's Linux-specific `linux.vapi` (`struct winsize`,
# `TIOCGWINSZ`) are declared portably in the sibling `terminal-compat.vapi`.
# Everything else is POSIX.1 (isatty / termios) plus GLib. See that vapi's
# header comment.
libGjsifyTerminal = library('gjsifyterminal', sources,
    dependencies: dependencies,
    vala_args: [
        '--pkg=posix',
        '--vapidir=' + meson.current_source_dir() / 'src/vala',
        '--pkg=terminal-compat',
    ],
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
    shared_lib_name = 'libgjsifyterminal.dylib'
else
    shared_lib_name = 'libgjsifyterminal.so'
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
    depends: libGjsifyTerminal,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

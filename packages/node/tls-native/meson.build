project('GjsifyTls', ['c', 'vala'], version: '1.0')

root_dir = meson.current_source_dir()

dependencies = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
    dependency('gio-2.0'),
    dependency('gnutls'),
]

sources = files(
    'src/vala/tls.vala',
    'src/vala/session-access.vala',
    # Phase-2 Path-A C shim. Compiled into the same shared lib so
    # SessionAccess can delegate without an additional dlopen step.
    # The header lives under `src/c/` and is reached via the
    # `c_args: ['-I…/src/c']` flag below.
    'src/c/gjsify-tls-private.c',
)

# Sibling vapis:
#   gnutls-ocsp.vapi        — Phase 1 OCSP parser bindings
#   gnutls-session.vapi     — channel-binding enum + function
#                              (Vala 0.56's bundled gnutls.vapi has
#                              session_set/get/get2/is_resumed already,
#                              but lacks gnutls_session_channel_binding)
#   gjsify-tls-private.vapi — Path-A C-shim bindings
#                              (session_t extraction + GnuTLS-call
#                              wrappers + GError mapping)
libGjsifyTls = library('gjsifytls', sources,
    dependencies: dependencies,
    c_args: [
        '-I' + meson.current_source_dir() / 'src/c',
    ],
    vala_args: [
        '--pkg=gnutls',
        '--vapidir=' + meson.current_source_dir() / 'src/vala',
        '--pkg=gnutls-ocsp',
        '--pkg=gnutls-session',
        '--pkg=gjsify-tls-private',
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
    shared_lib_name = 'libgjsifytls.dylib'
else
    shared_lib_name = 'libgjsifytls.so'
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
    depends: libGjsifyTls,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

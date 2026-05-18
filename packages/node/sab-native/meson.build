project('GjsifySabNative', ['c', 'vala'], version: '1.0')

root_dir = meson.current_source_dir()

# Required system packages (Fedora 43+):
#   dnf install vala meson ninja-build
#
# No external C libraries — sab-native uses libc-only primitives:
#   memfd_create(2), mmap(2), syscall(SYS_futex), __atomic_* GCC builtins,
#   AF_UNIX socketpair + SCM_RIGHTS.  All available on every Linux glibc since 3.17.
#
# Vala can't express the futex syscall + SCM_RIGHTS ancillary-data dance
# cleanly, so we wrap them in a small C shim (src/vala/sab-helpers.{h,c})
# and call into it from Vala via [CCode] extern declarations. Buffer ownership
# stays C-side, mirroring the @gjsify/http2-native nghttp2-helpers pattern.

vala_deps = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
    dependency('gio-2.0'),
]

sources = files(
    'src/vala/sab-helpers.c',
    'src/vala/shared-buffer.vala',
    'src/vala/fd-passing.vala',
)

# Compiler picks up sab-helpers.h via the include dir.
inc = include_directories('src/vala')

# -D_GNU_SOURCE: needed for memfd_create + MFD_CLOEXEC + SYS_futex visibility.
c_args = ['-D_GNU_SOURCE']

libGjsifySabNative = library('gjsifysabnative', sources,
    dependencies: vala_deps,
    include_directories: inc,
    c_args: c_args,
    vala_gir: meson.project_name() + '-1.0.gir',
    install: true,
    install_dir: [true, true, true, true],
)

g_ir_compiler = find_program('g-ir-compiler')

custom_target(meson.project_name() + '-1.0.typelib',
    command: [
        g_ir_compiler,
        '--shared-library', 'libgjsifysabnative.so',
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-1.0.gir',
    ],
    output: meson.project_name() + '-1.0.typelib',
    depends: libGjsifySabNative,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

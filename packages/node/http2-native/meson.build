project('GjsifyHttp2', ['c', 'vala'], version: '1.0')

root_dir = meson.current_source_dir()

# Required system packages (Fedora 43+):
#   dnf install vala meson ninja-build libnghttp2-devel
#
# Bindings: there is no upstream nghttp2 VAPI, so we wrap the handful of
# symbols we need in a small C shim (src/vala/nghttp2-helpers.{h,c}) and
# call into it from Vala via [CCode] extern declarations. This keeps every
# nghttp2 pointer C-side, mirroring the pattern in @gjsify/webrtc-native.
#
# We use cc.find_library / cc.find_header instead of `dependency()` for
# nghttp2 — `dependency()` makes meson pass `--pkg libnghttp2` to valac,
# which then looks for an nghttp2.vapi we don't have. find_library only
# affects the C compile + link stages, not Vala.
cc = meson.get_compiler('c')

nghttp2_lib = cc.find_library('nghttp2', has_headers: ['nghttp2/nghttp2.h'])

vala_deps = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
]

sources = files(
    'src/vala/nghttp2-helpers.c',
    'src/vala/frame-encoder.vala',
    'src/vala/stream-id-allocator.vala',
    'src/vala/session-bridge.vala',
)

# Compiler picks up nghttp2-helpers.h via the include dir.
inc = include_directories('src/vala')

libGjsifyHttp2 = library('gjsifyhttp2', sources,
    dependencies: vala_deps + [nghttp2_lib],
    include_directories: inc,
    vala_gir: meson.project_name() + '-1.0.gir',
    install: true,
    install_dir: [true, true, true, true],
)

g_ir_compiler = find_program('g-ir-compiler')

custom_target(meson.project_name() + '-1.0.typelib',
    command: [
        g_ir_compiler,
        '--shared-library', 'libgjsifyhttp2.so',
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-1.0.gir',
    ],
    output: meson.project_name() + '-1.0.typelib',
    depends: libGjsifyHttp2,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

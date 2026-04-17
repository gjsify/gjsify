project('GjsifyWebrtc', ['c', 'vala'], version: '0.1')

root_dir = meson.current_source_dir()

dependencies = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
    dependency('gstreamer-1.0'),
    dependency('gstreamer-sdp-1.0'),
    dependency('gstreamer-webrtc-1.0'),
]

sources = files(
    'src/vala/promise-bridge.vala',
    'src/vala/webrtcbin-bridge.vala',
    'src/vala/data-channel-bridge.vala',
    'src/vala/receiver-bridge.vala',
)

libGjsifyWebrtc = library('gjsifywebrtc', sources,
    dependencies: dependencies,
    vala_gir: meson.project_name() + '-0.1.gir',
    install: true,
    install_dir: [true, true, true, true],
)

g_ir_compiler = find_program('g-ir-compiler')

custom_target(meson.project_name() + '-0.1.typelib',
    command: [
        g_ir_compiler,
        '--shared-library', 'libgjsifywebrtc.so',
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-0.1.gir',
    ],
    output: meson.project_name() + '-0.1.typelib',
    depends: libGjsifyWebrtc,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

# `buildtype=plain` = NO `-g`. ld64 emits a DEBUG MAP into any image whose objects
# carry DWARF — one `N_OSO` stab per object, holding its MTIME — so with `-g` every
# rebuild of this commit differed in bytes (plus the `LC_UUID` and the ad-hoc signature
# computed over them) and `commit-prebuilds` re-committed all 16 darwin dylibs. That map
# names intermediate `.o` files no consumer can have. Why: docs/prebuilds.md.
project('GjsifyWebrtc', ['c', 'vala'], version: '0.1',
        default_options: ['buildtype=plain'])

root_dir = meson.current_source_dir()

host_system = host_machine.system()

# On darwin every GNOME library is resolved against the HOST PROCESS rather than
# recorded as an `@rpath/` dependency: a second GLib beside the one the host
# already loaded gives the process two GType registries, then SIGSEGV.
# docs/prebuilds.md § One GLib. The gstreamer packages are in the list because
# their own `--libs` carry `-lglib-2.0 -lgobject-2.0` — stripping only the glib
# pair would still let ld64 record a GLib load command.
host_provided = [
    'glib-2.0',
    'gobject-2.0',
    'gstreamer-1.0',
    'gstreamer-sdp-1.0',
    'gstreamer-webrtc-1.0',
]

dependencies = []
foreach pkg : host_provided
    dep = dependency(pkg)
    dependencies += host_system == 'darwin' \
        ? dep.partial_dependency(compile_args: true, includes: true) \
        : dep
endforeach

host_provided_link_args = host_system == 'darwin' ? ['-Wl,-undefined,dynamic_lookup'] : []

sources = files(
    'src/vala/promise-bridge.vala',
    'src/vala/webrtcbin-bridge.vala',
    'src/vala/data-channel-bridge.vala',
    'src/vala/receiver-bridge.vala',
)

libGjsifyWebrtc = library('gjsifywebrtc', sources,
    dependencies: dependencies,
    link_args: host_provided_link_args,
    vala_gir: meson.project_name() + '-0.1.gir',
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
    shared_lib_name = 'libgjsifywebrtc.dylib'
else
    shared_lib_name = 'libgjsifywebrtc.so'
endif

g_ir_compiler = find_program('g-ir-compiler')

custom_target(meson.project_name() + '-0.1.typelib',
    command: [
        g_ir_compiler,
        '--shared-library', shared_lib_name,
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-0.1.gir',
    ],
    output: meson.project_name() + '-0.1.typelib',
    depends: libGjsifyWebrtc,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

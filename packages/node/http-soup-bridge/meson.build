# `buildtype=plain` = NO `-g`. ld64 emits a DEBUG MAP into any image whose objects
# carry DWARF — one `N_OSO` stab per object, holding its MTIME — so with `-g` every
# rebuild of this commit differed in bytes (plus the `LC_UUID` and the ad-hoc signature
# computed over them) and `commit-prebuilds` re-committed all 16 darwin dylibs. That map
# names intermediate `.o` files no consumer can have. Why: docs/prebuilds.md.
project('GjsifyHttpSoupBridge', ['c', 'vala'], version: '1.0',
        default_options: ['buildtype=plain'])

root_dir = meson.current_source_dir()

host_system = host_machine.system()

# On darwin every GNOME library is resolved against the HOST PROCESS rather than
# recorded as an `@rpath/` dependency: a second GLib beside the one the host
# already loaded gives the process two GType registries, then SIGSEGV.
# docs/prebuilds.md § One GLib. libsoup is in the list because its own `--libs`
# carry `-lglib-2.0 -lgobject-2.0` — stripping only the glib trio would still
# let ld64 record a GLib load command.
host_provided = ['glib-2.0', 'gobject-2.0', 'gio-2.0']

dependencies = []
foreach pkg : host_provided
    dep = dependency(pkg)
    dependencies += host_system == 'darwin' \
        ? dep.partial_dependency(compile_args: true, includes: true) \
        : dep
endforeach

# libsoup is NOT left to `dynamic_lookup` like GLib: the host process (gjs) never
# loads it by itself, so an unrecorded libsoup leaves `soup_*` unbound and the
# class init dereferences NULL (SIGSEGV on a bare `imports.gi.<Ns>`). It is linked
# by path instead, which records ITS load command while GLib — absent from the
# link line — still binds to the host. docs/prebuilds.md § One GLib.
soup_dep = dependency('libsoup-3.0', version: '>=3.6')
if host_system == 'darwin'
    dependencies += soup_dep.partial_dependency(compile_args: true, includes: true)
    dependencies += meson.get_compiler('c').find_library('soup-3.0',
        dirs: soup_dep.get_variable(pkgconfig: 'libdir'))
else
    dependencies += soup_dep
endif

host_provided_link_args = host_system == 'darwin' ? ['-Wl,-undefined,dynamic_lookup'] : []

sources = files(
    'src/vala/peer-close-watch.vala',
    'src/vala/response.vala',
    'src/vala/request.vala',
    'src/vala/server.vala',
)

libGjsifyHttpSoupBridge = library('gjsifyhttpsoupbridge', sources,
    dependencies: dependencies,
    link_args: host_provided_link_args,
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
if host_system == 'darwin'
    shared_lib_name = 'libgjsifyhttpsoupbridge.dylib'
else
    shared_lib_name = 'libgjsifyhttpsoupbridge.so'
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
    depends: libGjsifyHttpSoupBridge,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

# `buildtype=plain` = NO `-g`. ld64 emits a DEBUG MAP into any image whose objects
# carry DWARF — one `N_OSO` stab per object, holding its MTIME — so with `-g` every
# rebuild of this commit differed in bytes (plus the `LC_UUID` and the ad-hoc signature
# computed over them) and `commit-prebuilds` re-committed all 16 darwin dylibs. That map
# names intermediate `.o` files no consumer can have. Why: docs/prebuilds.md.
project('GjsifySqlite', ['c', 'vala'], version: '1.0',
        default_options: ['buildtype=plain'])

root_dir = meson.current_source_dir()

# Required system packages (Fedora 43+):
#   dnf install vala meson ninja-build sqlite-devel
#
# Bindings: Vala SHIPS a `sqlite3.vapi`, so unlike the nghttp2 bridge this one
# needs no C shim — `--pkg=sqlite3` gives Vala the whole API it uses. The four
# entry points that vapi predates are declared in src/vala/sqlite-compat.vapi,
# which is why `--vapidir` points back into this package.
#
# We use cc.find_library instead of `dependency()` for sqlite3 — `dependency()`
# makes meson pass `--pkg sqlite3` to valac AS A PKG-CONFIG NAME and then also
# hand it the pkg-config vapi lookup, which collides with the bundled vapi we
# want. find_library only affects the C compile + link stages, not Vala.
# macOS needs no formula for it: libsqlite3 and sqlite3.h are both in the SDK.
cc = meson.get_compiler('c')

sqlite3_lib = cc.find_library('sqlite3', has_headers: ['sqlite3.h'])

# `sqlite3_changes64` arrived in sqlite 3.37 (2021-11). Asserting it here turns a
# too-old libsqlite3 into a configure error naming the version, instead of an
# undefined symbol at link time or — on a host that links lazily — at dlopen,
# which docs/prebuilds.md records as the failure nobody reads correctly.
assert(cc.has_function('sqlite3_changes64',
                       prefix: '#include <sqlite3.h>',
                       dependencies: sqlite3_lib),
       'libsqlite3 is older than 3.37: sqlite3_changes64 is missing')

host_system = host_machine.system()

# On darwin every GNOME library is resolved against the HOST PROCESS rather than
# recorded as an `@rpath/` dependency: a second GLib beside the one the host
# already loaded gives the process two GType registries, then SIGSEGV.
# docs/prebuilds.md § One GLib. libsqlite3 is NOT host-provided — it reaches no
# GLib, so it stays an ordinary link dependency.
host_provided = ['glib-2.0', 'gobject-2.0']

vala_deps = []
foreach pkg : host_provided
    dep = dependency(pkg)
    vala_deps += host_system == 'darwin' \
        ? dep.partial_dependency(compile_args: true, includes: true) \
        : dep
endforeach

host_provided_link_args = host_system == 'darwin' ? ['-Wl,-undefined,dynamic_lookup'] : []

sources = files(
    'src/vala/database.vala',
    'src/vala/statement.vala',
)

libGjsifySqlite = library('gjsifysqlite', sources,
    dependencies: vala_deps + [sqlite3_lib],
    vala_args: [
        '--pkg=sqlite3',
        '--vapidir=' + root_dir / 'src/vala',
        '--pkg=sqlite-compat',
    ],
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
    shared_lib_name = 'libgjsifysqlite.dylib'
else
    shared_lib_name = 'libgjsifysqlite.so'
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
    depends: libGjsifySqlite,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

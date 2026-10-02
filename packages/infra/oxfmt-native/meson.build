# `buildtype=plain` = NO `-g`. ld64 emits a DEBUG MAP into any image whose objects
# carry DWARF — one `N_OSO` stab per object, holding its MTIME — so with `-g` every
# rebuild of this commit differed in bytes (plus the `LC_UUID` and the ad-hoc signature
# computed over them) and `commit-prebuilds` re-committed all 16 darwin dylibs. That map
# names intermediate `.o` files no consumer can have. Why: docs/prebuilds.md.
project('GjsifyOxfmt', ['c', 'vala'], version: '1.0',
        default_options: ['buildtype=plain'])

# Required system packages (Fedora 43+):
#   dnf install vala meson ninja-build cargo
# and the refs/oxc submodule:
#   git submodule update --init refs/oxc
#
# Pipeline:
#   src/rust/   → cargo builds libgjsify_oxfmt.so (cdylib, against refs/oxc)
#   src/vala/   → vala compiles GjsifyOxfmt-1.0.so + GIR + typelib
#   The Vala lib links against the Rust cdylib via -lgjsify_oxfmt.

cc = meson.get_compiler('c')

vala_deps = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
]

# ----------------------------------------------------------------------------
# Host-dependent naming + runtime-lookup conventions
#
# Three things differ per host and MUST agree, or the prebuild loads on one
# platform and silently fails on the other (mirrors @gjsify/napi's meson
# branch):
#
#   1. cargo's cdylib leaf     — libgjsify_oxfmt.{so,dylib}
#   2. meson's library() leaf  — libgjsifyoxfmt.{so,dylib}; the typelib records
#      this name and gjs' g_module_open() resolves exactly it at load.
#   3. how the Vala library finds its sibling Rust cdylib at runtime. Both
#      files ship side by side in prebuilds/<platform>-<arch>/, so the lookup
#      must be relative to the loading binary: $ORIGIN on ELF, @loader_path on
#      Mach-O. On macOS this is load-bearing — unlike Linux (where the CLI
#      exports LD_LIBRARY_PATH for the prebuild dir) nothing sets
#      DYLD_LIBRARY_PATH, so the rpath is the ONLY way the cdylib is found.
#
# Windows is deliberately absent: no Vala bridge here has had any Windows
# portability work, so `else` (ELF naming) is the honest fallback rather than a
# .dll branch that would imply support that does not exist.
# ----------------------------------------------------------------------------
host_system = host_machine.system()

if host_system == 'darwin'
    rust_cdylib_name = 'libgjsify_oxfmt.dylib'
    shared_lib_name = 'libgjsifyoxfmt.dylib'
    lib_rpath = '@loader_path'
    # Normalise the cdylib's LC_ID_DYLIB to @rpath/<leaf> BEFORE the Vala
    # library links against it: ld64 copies the dependency's install name
    # verbatim into the dependent's LC_LOAD_DYLIB. Pinning it here makes the
    # recorded dependency rustc-version-independent, and @rpath/ is never
    # longer than an absolute path so install_name_tool can always rewrite in
    # place.
    #
    # The cdylib must be a FUNCTION OF ITS SOURCES, and on darwin that takes
    # TWO steps, only the first of which `install_name_tool` could do.
    # MEASURED with rustc 1.98.1 / ld64-27037.1 (macOS 27, arm64); the whole
    # measurement and the reasoning behind each step: scripts/macho-set-uuid.mjs.
    #
    # 1. THE INSTALL NAME, at the LINK. rustc still gives a cdylib the ABSOLUTE
    #    path of its own output as `LC_ID_DYLIB`
    #    (`<builddir>/cargo-target/release/deps/<leaf>`), so the build
    #    directory's name and LENGTH reach the artifact: the recorded name, the
    #    load-command block's size, and therefore every section address after it.
    #    Without this, two builds from `build/` and `builddir/` differ by 8 bytes
    #    of pure layout before any content is compared. ld64 takes the LAST
    #    `-install_name` (verified), and a `-C link-arg` lands after rustc's own,
    #    so this one wins. `install_name_tool` then keeps the recorded dependency
    #    rustc-version-independent.
    # 2. THE UUID, after every other edit (the script, which re-signs). ld64
    #    computed that field over the image it emitted and `install_name_tool`
    #    recomputes neither it nor the signature — and it is not a function of
    #    the emitted bytes even so, so pinning the name above still leaves 48
    #    moving bytes (16 `LC_UUID` + 32 of the signature hashing it). It is
    #    derived from the image instead, so if the CODE ever stops being a
    #    function of the sources the UUID moves with it and
    #    `check-prebuild-reproducible.mjs` still reds; nothing here hides
    #    content drift.
    rust_cargo_link_args = ' -- -C link-arg=-Wl,-install_name,@rpath/' + rust_cdylib_name
    rust_cargo_cmd = 'cargo rustc --lib'
    # The repo's OWN script, from the package's own meson.build — so a bridge
    # built outside the workspace has to say so itself rather than silently
    # skipping the step that makes its artifact reproducible.
    set_uuid_tool = meson.current_source_dir() / '..' / '..' / '..' / 'scripts' / 'macho-set-uuid.mjs'
    rust_cdylib_post = ' && install_name_tool -id "@rpath/' + rust_cdylib_name + '" "$3"' \
                      + ' && ' + find_program('node').full_path() + ' "' + set_uuid_tool + '" "$3"'
else
    rust_cdylib_name = 'libgjsify_oxfmt.so'
    shared_lib_name = 'libgjsifyoxfmt.so'
    lib_rpath = '$ORIGIN'
    # ELF records a bare SONAME and no UUID load command, and its link line is
    # already a function of the sources: the darwin branch's steps have no ELF
    # spelling, so this one is left exactly as it was.
    rust_cargo_link_args = ''
    rust_cargo_cmd = 'cargo build'
    rust_cdylib_post = ''
endif

# ----------------------------------------------------------------------------
# Rust cdylib (cargo)
#
# Single custom_target combining `cargo build` and copying the resulting
# cdylib into the meson build dir under the expected name, so meson tracks
# it as a build artifact and serializes the Vala link step behind it.
# ----------------------------------------------------------------------------
# `cargo rustc --lib -- <args>` rather than `cargo build`, so the link args reach
# the FINAL crate's rustc and no other: the dependency rlibs and any build
# script are linked without them, and a pinned `-install_name` on an executable
# is not a thing ld64 wants.
cargo = find_program('cargo')

rust_sources = files(
    'src/rust/Cargo.toml',
    'src/rust/Cargo.lock',
    'src/rust/src/lib.rs',
)

rust_target_dir = meson.current_build_dir() / 'cargo-target'

# `${CI:+--locked}` — on a CI runner (GitHub Actions always exports CI=true) the
# committed src/rust/Cargo.lock is ENFORCED: cargo fails loudly instead of
# re-resolving the registry and rewriting the lock, so a lock that no longer
# satisfies Cargo.toml (or a refs/oxc bump that moved a path crate's version)
# reds the run rather than silently shipping a differently-linked prebuild.
# Locally the flag expands to nothing, so editing Cargo.toml still just works —
# commit the resulting lock diff together with the change.
rust_cdylib = custom_target('gjsify-oxfmt-rust',
    input:  rust_sources,
    output: rust_cdylib_name,
    command: ['sh', '-c',
              rust_cargo_cmd + ' --release ${CI:+--locked} --manifest-path "$1" --target-dir "$2"'
                  + rust_cargo_link_args + ' && cp "$2/release/'
                  + rust_cdylib_name + '" "$3"' + rust_cdylib_post,
              'sh',
              meson.current_source_dir() / 'src/rust/Cargo.toml',
              rust_target_dir,
              '@OUTPUT@',
    ],
    build_by_default: true,
    install: false,
)

# ----------------------------------------------------------------------------
# Vala library + GIR + typelib
# ----------------------------------------------------------------------------
sources = files(
    'src/vala/gjsify-oxfmt-glue.c',
    'src/vala/oxfmt.vala',
)

inc = include_directories('src/vala')

# Tell ld where to find libgjsify_oxfmt.so (placed there by rust_cdylib)
link_args = ['-L' + meson.current_build_dir(), '-lgjsify_oxfmt']

libGjsifyOxfmt = library('gjsifyoxfmt', sources,
    dependencies: vala_deps,
    include_directories: inc,
    vala_gir: meson.project_name() + '-1.0.gir',
    link_args: link_args,
    link_depends: rust_cdylib,
    install: true,
    install_dir: [true, true, true, true],
    # `build_rpath` (not just `install_rpath`) is what matters for the prebuild:
    # the artifact shipped in prebuilds/ is copied straight out of the build
    # dir, never through `meson install`, so only the build-tree rpath survives.
    build_rpath: lib_rpath,
    install_rpath: lib_rpath,
)

g_ir_compiler = find_program('g-ir-compiler')

custom_target(meson.project_name() + '-1.0.typelib',
    command: [
        g_ir_compiler,
        '--shared-library', shared_lib_name,
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-1.0.gir',
    ],
    output: meson.project_name() + '-1.0.typelib',
    depends: libGjsifyOxfmt,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

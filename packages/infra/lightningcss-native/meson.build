project('GjsifyLightningcss', ['c', 'vala'], version: '1.0')

# Required system packages (Fedora 43+):
#   dnf install vala meson ninja-build cargo
#
# Pipeline:
#   src/rust/   → cargo builds libgjsify_lightningcss.so (cdylib)
#   src/vala/   → vala compiles GjsifyLightningcss-1.0.so + GIR + typelib
#   The Vala lib links against the Rust cdylib via -lgjsify_lightningcss.

cc = meson.get_compiler('c')

vala_deps = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
]

# ----------------------------------------------------------------------------
# Rust cdylib (cargo)
#
# Single custom_target combining `cargo build` and copying the resulting
# cdylib into the meson build dir under the expected name. Output is the
# real .so the Vala library will link against and the prebuild script
# will package — so meson tracks it as a build artifact and serializes
# the Vala link step behind it.
# ----------------------------------------------------------------------------
cargo = find_program('cargo')

rust_sources = files(
    'src/rust/Cargo.toml',
    'src/rust/src/lib.rs',
)

rust_target_dir = meson.current_build_dir() / 'cargo-target'

rust_cdylib = custom_target('gjsify-lightningcss-rust',
    input:  rust_sources,
    output: 'libgjsify_lightningcss.so',
    command: ['sh', '-c',
              'cargo build --release --manifest-path "$1" --target-dir "$2" && cp "$2/release/libgjsify_lightningcss.so" "$3"',
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
    'src/vala/gjsify-lightningcss-glue.c',
    'src/vala/lightningcss.vala',
)

inc = include_directories('src/vala')

# Tell ld where to find libgjsify_lightningcss.so (placed there by rust_cdylib)
link_args = ['-L' + meson.current_build_dir(), '-lgjsify_lightningcss']

libGjsifyLightningcss = library('gjsifylightningcss', sources,
    dependencies: vala_deps,
    include_directories: inc,
    vala_gir: meson.project_name() + '-1.0.gir',
    link_args: link_args,
    link_depends: rust_cdylib,
    install: true,
    install_dir: [true, true, true, true],
    install_rpath: '$ORIGIN',
)

g_ir_compiler = find_program('g-ir-compiler')

custom_target(meson.project_name() + '-1.0.typelib',
    command: [
        g_ir_compiler,
        '--shared-library', 'libgjsifylightningcss.so',
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-1.0.gir',
    ],
    output: meson.project_name() + '-1.0.typelib',
    depends: libGjsifyLightningcss,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

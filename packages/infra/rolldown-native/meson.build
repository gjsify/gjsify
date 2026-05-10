project('GjsifyRolldown', ['c', 'vala'], version: '1.0')

# Required system packages (Fedora 43+):
#   dnf install vala meson ninja-build cargo
# Plus: refs/rolldown submodule must be checked out (see Cargo.toml note).
#
# Pipeline:
#   src/rust/   → cargo builds libgjsify_rolldown.so (cdylib, ~30 MB release)
#   src/vala/   → vala compiles GjsifyRolldown-1.0.so + GIR + typelib
#   The Vala lib links against the Rust cdylib via -lgjsify_rolldown.

cc = meson.get_compiler('c')

vala_deps = [
    dependency('glib-2.0'),
    dependency('gobject-2.0'),
    # json-glib is used by BundlerSession to peek at the hook name +
    # request id from the Rust-emitted JSON envelope before routing
    # to the matching GObject signal. The full payload is forwarded
    # to JS unparsed.
    dependency('json-glib-1.0'),
]

# ----------------------------------------------------------------------------
# Rust cdylib (cargo)
# ----------------------------------------------------------------------------
cargo = find_program('cargo')

rust_sources = files(
    'src/rust/Cargo.toml',
    'src/rust/src/lib.rs',
    'src/rust/src/plugin_proxy.rs',
    'src/rust/src/session.rs',
)

rust_target_dir = meson.current_build_dir() / 'cargo-target'

rust_cdylib = custom_target('gjsify-rolldown-rust',
    input:  rust_sources,
    output: 'libgjsify_rolldown.so',
    command: ['sh', '-c',
              'cargo build --release --manifest-path "$1" --target-dir "$2" && cp "$2/release/libgjsify_rolldown.so" "$3"',
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
    'src/vala/gjsify-rolldown-glue.c',
    'src/vala/rolldown.vala',
)

inc = include_directories('src/vala')

link_args = ['-L' + meson.current_build_dir(), '-lgjsify_rolldown']

libGjsifyRolldown = library('gjsifyrolldown', sources,
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
        '--shared-library', 'libgjsifyrolldown.so',
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-1.0.gir',
    ],
    output: meson.project_name() + '-1.0.typelib',
    depends: libGjsifyRolldown,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

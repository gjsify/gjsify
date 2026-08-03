# `vala` is added CONDITIONALLY below rather than declared here, because declaring
# a language makes meson require its compiler at `meson setup` time — and the
# whole point of the `prebuilt_vala_c` option is a host that has no valac. Adding
# it via `add_languages()` on the branch that needs it is the only difference from
# `project('Gwebgl', ['c', 'vala'], …)`; the Vala path below is otherwise
# unchanged.
project('Gwebgl', ['c'], version: '0.1')

root_dir = meson.current_source_dir()

vapi_dir = root_dir / 'src/vapi'

gir_name = meson.project_name() + '-0.1.gir'

# ONE source list, TWO consumers: valac compiles these entries on a host that has
# it, and the prebuilt-C branch derives its `.c` file names from the very same
# entries. A second hand-written list of `.c` names is how the two halves would
# drift — the file that got added to one and not the other fails at LINK time
# with an undefined symbol, a long way from the list that caused it.
vala_sources = [
    'src/vala/handle-types.vala',
    'src/vala/webgl-rendering-context-base.vala',
    'src/vala/webgl-rendering-context.vala',
    'src/vala/webgl2-rendering-context.vala',
]

dependencies = [ dependency('glib-2.0'), dependency('gobject-2.0'), dependency('gdk-pixbuf-2.0'), dependency('gtk4'), dependency('epoxy')]

prebuilt_vala_c = get_option('prebuilt_vala_c')

if prebuilt_vala_c == ''
    add_languages('vala', native: false)

    add_project_arguments(
        [
            '--vapidir', vapi_dir,
        ],
        language: 'vala'
    )

    sources = files(vala_sources)

    libGwebgl = library('gwebgl', sources,
        dependencies: dependencies,
        vala_gir:  gir_name,
        install: true,
        install_dir: [true, true, true, true]
    )

    gir_path = meson.current_build_dir() / gir_name

    # Test app — Vala-only by construction, so it lives on this branch. It is not
    # part of the shipped prebuild and the Windows experiment does not need it.
    test_sources = files('src/vala/handle-types.vala', 'src/vala/webgl-rendering-context-base.vala', 'src/vala/webgl-rendering-context.vala', 'src/test/app.vala')
    executable('gwebgl_vala_app', test_sources, dependencies: dependencies)
else
    # The C valac already emitted, compiled by whatever C compiler this host has.
    # Nothing here is Windows-specific: the branch is "somebody else ran valac",
    # not "this is MSVC", which is why a Linux host can exercise it too — and
    # should, because a branch only Windows takes is a branch nobody reviews.
    prebuilt_c = []
    foreach vala_source : vala_sources
        prebuilt_c += prebuilt_vala_c / vala_source.replace('.vala', '.c')
    endforeach

    libGwebgl = library('gwebgl', files(prebuilt_c),
        dependencies: dependencies,
        # The generated `.c` files do `#include "gwebgl.h"`, which sits at the
        # ROOT of the artifact while they sit under `src/vala/` — so the quoted
        # include does not find it next to the includer and needs this -I.
        include_directories: include_directories(prebuilt_vala_c),
        install: true
    )

    gir_path = root_dir / prebuilt_vala_c / gir_name
endif

# ----------------------------------------------------------------------------
# The shared-library leaf name the typelib records — ASKED, not predicted.
#
# g-ir-compiler bakes this string into the typelib and it is exactly what
# g_module_open() resolves at load time, so getting it wrong yields a typelib
# that IS found via GI_TYPELIB_PATH but whose library never loads: a silent
# failure that looks like a broken rpath.
#
# This used to be an `if host_machine.system() == 'darwin'` chain with an ELF
# fallback, and the chain was the problem rather than any single branch. It has
# to predict a filename meson has ALREADY decided, and the mapping is not a
# function of the OS alone — on Windows the same `library()` is `gwebgl.dll`
# under MSVC and `libgwebgl.dll` under MinGW, so an OS branch cannot be right
# for both. Reading the name back off the target is correct by construction for
# every host and toolchain, including ones nobody has tried yet, and it removes
# the one thing a Windows port would otherwise have had to guess.
# ----------------------------------------------------------------------------
fs = import('fs')
shared_lib_name = fs.name(libGwebgl.full_path())

g_ir_compiler = find_program('g-ir-compiler')


# TODO not working if gwebgl-0.1.gir not exists
custom_target(meson.project_name() + '-0.1.typelib', command: [g_ir_compiler, '--shared-library', shared_lib_name, '--output', '@OUTPUT@', gir_path],
              #input: gir_path,
              output: meson.project_name() +'-0.1.typelib',
              depends: libGwebgl,
              install: true,
              install_dir: get_option('libdir') / 'girepository-1.0')

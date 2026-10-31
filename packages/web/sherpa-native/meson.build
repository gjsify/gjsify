# GjsifySherpa — sherpa-onnx's speech engines behind a GObject API: a Silero
# voice activity detector and two transducer recognizers (ADR 0127 decision 5).
#
# `buildtype=plain` = NO `-g`, the same choice as the sibling Vala bridges. ld64
# emits a DEBUG MAP into any image whose objects carry DWARF — one `N_OSO` stab
# per object, holding its MTIME — so with `-g` every rebuild of one commit
# differs in bytes and `commit-prebuilds` re-commits the lot. It matters more
# here than anywhere else in this repo: sherpa-onnx and onnxruntime are compiled
# INTO this library, so their debug info would be this prebuild's size.
# Why: docs/prebuilds.md.
#
# `cpp` is in the language list although this package contains no C++ source:
# sherpa-onnx and onnxruntime are C++ static archives, and a target whose own
# sources are only C and Vala would be linked with the C driver — which does not
# add the C++ runtime, so the link fails on a few thousand undefined
# `std::` symbols. `link_language: 'cpp'` on the library below is the fix, and it
# requires the language to be declared here.
project('GjsifySherpa', ['c', 'cpp', 'vala'], version: '1.0',
        meson_version: '>= 1.3.0',
        default_options: ['c_std=c11', 'cpp_std=c++17', 'buildtype=plain'])

root_dir = meson.current_source_dir()

cc = meson.get_compiler('c')
cmake = import('cmake')
fs = import('fs')

host_system = host_machine.system()
is_darwin = host_system == 'darwin'
is_linux = host_system == 'linux'

if not (is_darwin or is_linux)
    # Not "unsupported forever": sherpa-onnx builds on Windows and the C API is
    # the same. It is that nobody has done the work, and package.json says so in
    # `gjsify.platformsUncommitted` rather than letting a build here imply it.
    error('GjsifySherpa is built for linux and darwin. ' + host_system +
          ' has had no portability work — see package.json gjsify.platformsUncommitted.')
endif

# ----------------------------------------------------------------------------
# § onnxruntime — the inference engine, SHARED, by an OVERLAY on the wrap.
#
# Everything else in this prebuild is static; this one library cannot be.
# subprojects/sherpa-onnx.wrap carries the measurement: the `libonnxruntime.a`
# that upstream's static branch links was built by an old GCC and collides,
# symbol for symbol, with the host GCC's own vague-linkage instantiations of
# `std::__detail::_Scanner<char>` — same mangled name, different layout, because
# libstdc++ puts `regex_traits` in `std::__cxx11` and `_Scanner` in plain
# `std::__detail`. The result is not a link error but a corrupted heap on the
# first session onnxruntime opens.
#
# HOW THE SHARED ENGINE GETS IN, and the two ways that did not work:
#
#   1. `BUILD_SHARED_LIBS=ON` — makes sherpa-onnx itself eleven shared libraries
#      too, and this package's premise is one `.so` behind a version script with
#      nothing of the engines visible. Rejected on that, not on difficulty.
#   2. A separate onnxruntime wrap handed over as
#      `SHERPA_ONNX_USE_PRE_INSTALLED_ONNXRUNTIME_IF_AVAILABLE=ON` plus
#      `location_onnxruntime_header_dir` / `location_onnxruntime_lib` cache
#      defines. Configures cleanly and is the arrangement upstream documents —
#      but meson then DROPPED the include directory it was handed:
#      `WARNING: CMake: path ... is inside the root project but not inside the
#      subproject -> Ignoring`, and sherpa-onnx's own compile died on
#      `fatal error: onnxruntime_cxx_api.h: No such file or directory`. meson's
#      cmake module REGENERATES the subproject's targets as meson targets rather
#      than delegating to cmake, and it will only carry include paths that live
#      inside the subproject's own build directory.
#
# Which is what settled it: FetchContent lands its download inside the
# subproject's build directory, so letting sherpa-onnx fetch the SHARED archive
# through its own FetchContent is the one route whose include path meson keeps.
# The overlay in subprojects/packagefiles/ is exactly that and nothing more.
#
# Coverage is per OVERLAY FILE, one per architecture, since each pins a binary
# release archive. A linux arch with no overlay is an ERROR rather than a
# fallback to upstream's static file — that fallback IS the broken arrangement,
# and finding out by way of a corrupted heap is what this check exists to prevent.
# ----------------------------------------------------------------------------
onnxruntime_overlays = {'x86_64': 'onnxruntime-linux-x86_64-static.cmake'}

if is_linux and not onnxruntime_overlays.has_key(host_machine.cpu_family())
    error(
        'No shared-onnxruntime overlay for linux/' + host_machine.cpu_family() + '.\n' +
        '  Copy subprojects/sherpa-onnx/cmake/onnxruntime-linux-<arch>.cmake (the SHARED\n' +
        '  one) to subprojects/packagefiles/sherpa-onnx-shared-onnxruntime/cmake/ under the\n' +
        '  name of the -static one, drop its BUILD_SHARED_LIBS guard, and name it in\n' +
        '  `onnxruntime_overlays` here. Do NOT drop this check and let sherpa-onnx link its\n' +
        '  static archive instead — see subprojects/sherpa-onnx.wrap for what that does to a\n' +
        '  build by a current GCC.',
    )
endif

# ----------------------------------------------------------------------------
# sherpa-onnx — pinned by subprojects/sherpa-onnx.wrap, consumed as a CMAKE
# subproject because it has no meson build. Same arrangement as `sdl3.wrap` in
# packages/web/gamepad-native.
#
# STATIC for sherpa-onnx itself (`BUILD_SHARED_LIBS=OFF`), so its eleven archives
# and this shim become one `libgjsifysherpa.so` behind a version script.
# onnxruntime is the one exception and is linked SHARED — it has to be, because
# the static archive upstream would otherwise select cannot be linked into C++
# built by a current GCC without corrupting memory. The mechanism, the crash it
# produced and why the shared library is the correct arrangement rather than a
# workaround are in subprojects/sherpa-onnx.wrap; § onnxruntime above is how
# this build gets there.
#
# Everything not reached from the C API's VAD and transducer paths is off:
# PortAudio and the websocket server are programs, not libraries; TTS would drag
# in espeak-ng, piper-phonemize and cppinyin; speaker diarization is another
# model family nobody here runs. What stays, and still gets fetched by
# sherpa-onnx's own CMake, is kaldi-native-fbank, kaldi-decoder, utf8proc,
# simple-sentencepiece and nlohmann/json.
# ----------------------------------------------------------------------------
sherpa_defines = {
    'BUILD_SHARED_LIBS': false,
    'SHERPA_ONNX_ENABLE_C_API': true,
    'SHERPA_ONNX_ENABLE_PORTAUDIO': false,
    'SHERPA_ONNX_ENABLE_WEBSOCKET': false,
    'SHERPA_ONNX_ENABLE_BINARY': false,
    'SHERPA_ONNX_ENABLE_TTS': false,
    'SHERPA_ONNX_ENABLE_SPEAKER_DIARIZATION': false,
    'SHERPA_ONNX_ENABLE_TESTS': false,
    'SHERPA_ONNX_ENABLE_PYTHON': false,
    'SHERPA_ONNX_ENABLE_JNI': false,
    'SHERPA_ONNX_BUILD_C_API_EXAMPLES': false,
    # The static archives are linked into a shared library.
    'CMAKE_POSITION_INDEPENDENT_CODE': true,
}

# ----------------------------------------------------------------------------
# THE SYSTEM-ONNXRUNTIME TRAP, disarmed.
#
# OFF is already the upstream default, and it is set here anyway because ON is
# the one thing that would quietly undo § onnxruntime. Left to search, that
# option runs `find_path`/`find_library` over `/usr/include/onnxruntime` and
# `/usr/lib`: Fedora 44 HAS libonnxruntime.so.1 (1.22.2) and NOT its headers, so
# the find half succeeds on some hosts and the compile fails on them, and where
# it does work the prebuild carries a dependency on whatever onnxruntime the
# build machine happened to have. OFF means the version is the wrap's, always.
# ----------------------------------------------------------------------------
sherpa_defines += {'SHERPA_ONNX_USE_PRE_INSTALLED_ONNXRUNTIME_IF_AVAILABLE': false}

# ----------------------------------------------------------------------------
# THE LIBSTDC++ DECISION, and why it is probed rather than chosen.
#
# sherpa-onnx defaults `SHERPA_ONNX_LINK_LIBSTDCPP_STATICALLY` to ON for a static
# build, and for a REDISTRIBUTABLE prebuild that default is the one worth having.
# Linking libstdc++ dynamically gives the `.so` a DT_NEEDED on libstdc++.so.6
# together with a GLIBCXX_ version floor set by whatever GCC built it — this host
# is Fedora 44 with GCC 16, so a prebuild from here would refuse to load on
# Debian 12 (GLIBCXX_3.4.30). Static libstdc++ has no floor, and it is safe here
# precisely because the version script exports only this library's C API: no C++
# type, exception or `std::` symbol crosses the boundary, so there is nothing for
# a second C++ runtime in the process to disagree with.
#
# It needs `libstdc++.a`, which Fedora ships in `libstdc++-static` and does NOT
# install by default. Without it the build does not fail here — it fails four
# dependencies deep, in simple-sentencepiece's `check_cxx_compiler_flag`, as
# "requires a compiler supporting at least C++14. If you are using GCC, please
# upgrade it to at least version 7.0". That message blames the compiler for a
# missing archive and sent this build down the wrong path once already, so the
# probe below answers the question up front and names the package.
#
# A host without it still gets a WORKING build, just not a shippable one, so a
# contributor's laptop gets a warning. The prebuild legs are the place where a
# non-portable artifact is worse than no artifact, and they pass
# `-Drequire_static_libstdcxx=true` to make the same probe a hard error.
# ----------------------------------------------------------------------------
libstdcxx_a = run_command(cc.cmd_array() + ['-print-file-name=libstdc++.a'], check: false)
# gcc echoes the bare filename back when it cannot find it, so "is the answer an
# absolute path that exists" is the test — not the exit status, which is 0 either way.
libstdcxx_a_path = libstdcxx_a.stdout().strip()
have_static_libstdcxx = libstdcxx_a.returncode() == 0 \
    and libstdcxx_a_path.startswith('/') \
    and fs.exists(libstdcxx_a_path)

if not have_static_libstdcxx
    libstdcxx_a_message = 'libstdc++.a not found — building against the SHARED libstdc++.\n' + \
        '  The resulting library carries a DT_NEEDED on libstdc++.so.6 plus this\n' + \
        '  compiler\'s GLIBCXX_ floor, so it is NOT a portable prebuild. Install it:\n' + \
        '    Fedora/RHEL  dnf install libstdc++-static\n' + \
        '    Debian/Ubuntu already present in libstdc++-*-dev\n' + \
        '    Alpine       apk add libstdc++-dev'
    if get_option('require_static_libstdcxx')
        error(libstdcxx_a_message)
    endif
    warning(libstdcxx_a_message)
endif

sherpa_defines += {'SHERPA_ONNX_LINK_LIBSTDCPP_STATICALLY': have_static_libstdcxx}

sherpa_options = cmake.subproject_options()
sherpa_options.add_cmake_defines(sherpa_defines)
if is_linux
    # Lets --gc-sections (below) drop what the shim never reaches. sherpa-onnx
    # compiles every model family it supports, and this bridge calls into three
    # of them.
    sherpa_options.append_compile_args('c', ['-ffunction-sections', '-fdata-sections'])
    sherpa_options.append_compile_args('cpp', ['-ffunction-sections', '-fdata-sections'])
endif

sherpa = cmake.subproject('sherpa-onnx', options: sherpa_options)
sherpa_dep = sherpa.dependency('sherpa-onnx-c-api')

# sherpa-onnx sets its include path with a directory-scoped
# `include_directories()`, which is not a target property and so is not
# something meson's cmake module can read off the target. The header this shim
# includes is `<sherpa-onnx/c-api/c-api.h>`, relative to the wrap checkout root.
# The checkout exists by now: cmake.subproject() above is what fetches it.
sherpa_inc = include_directories('subprojects' / 'sherpa-onnx')

# ----------------------------------------------------------------------------
# Staging the engine beside the library.
#
# libonnxruntime.so has to sit NEXT TO libgjsifysherpa.so in the prebuild:
# DT_NEEDED records its SONAME, and RUNPATH `$ORIGIN` resolves that against the
# library's own directory. `scripts/stage-prebuild.mjs` stages the `.so`/`.gir`/
# `.typelib` files it finds in the TOP LEVEL of the build directory, so the copy
# is a build step rather than something a packaging script has to know how to go
# looking for.
#
# The source path is a meson INTERNAL — where its cmake module puts the CMake
# build tree, and inside that where sherpa-onnx's FetchContent puts the archive
# it unpacked. Both are stable but neither is API, so `fs.exists()` checks it and
# says what to look for when it moves. `cp` through a `custom_target` rather than
# `fs.copyfile`: taking a file out of a nested subproject is a sandbox violation
# there (rightly, in general — but this is a byte copy of a binary release
# artifact), and the path therefore goes in as a plain string, which also means
# there is no dependency edge back to it.
#
# AND IT IS STRIPPED ON THE WAY. The upstream release is shipped "not stripped":
# 27,026,609 bytes, of which a `.symtab` plus a 4.9 MB `.strtab` are a debug
# symbol table nothing in this prebuild can use — `strip --strip-all` measured
# 21,007,808, so 6.0 MB (22 %) of the biggest file in the artifact is dead weight
# that `commit-prebuilds` would write into git on every rebuild.
# `libgjsifysherpa.so` is already stripped by `-Wl,--strip-all` at link time; this
# is the same decision applied to the one file in the prebuild that is not ours to
# link.
#
# `strip` is PROBED rather than assumed, like libstdc++.a above: a host without
# binutils must still get a working build, so staging falls back to the plain `cp`
# with a warning. The `elf-deps` test gets `--require-stripped-engine` only when
# the probe found it, so the assertion is made exactly where the saving was taken.
# ----------------------------------------------------------------------------
strip_prog = find_program('strip', required: false)

if is_linux and not strip_prog.found()
    warning(
        'strip not found — staging the engine unstripped.\n' +
        '  libonnxruntime.so stays ~6 MB larger than it needs to be, which costs nothing\n' +
        '  locally and 6 MB per rebuild in a committed prebuild. Install binutils.',
    )
endif

if is_linux
    onnxruntime_built = meson.project_build_root() / 'subprojects' / 'sherpa-onnx' \
        / '__CMake_build' / '_deps' / 'onnxruntime-src' / 'lib' / 'libonnxruntime.so'

    if not fs.exists(onnxruntime_built)
        error(
            'The shared onnxruntime is not where this build expects it:\n' +
            '    ' + onnxruntime_built + '\n' +
            '  That path is two meson/cmake internals deep — where the cmake module puts the\n' +
            '  CMake build tree, and where sherpa-onnx\'s FetchContent unpacks onnxruntime.\n' +
            '  Find the real one with `find ' + meson.project_build_root() +
            ' -name libonnxruntime.so`\n' +
            '  and correct the path here. If there is no such file at all, the overlay in\n' +
            '  subprojects/packagefiles/ did not apply — `rm -rf subprojects/sherpa-onnx` and\n' +
            '  reconfigure, since meson only patches a checkout it creates itself.',
        )
    endif

    # `strip -o` writes a stripped COPY and leaves the input alone, so this is
    # still one command producing one output — the subproject's file is never
    # modified in place, which would make the build non-idempotent.
    onnxruntime_staged = custom_target(
        'libonnxruntime.so',
        output: 'libonnxruntime.so',
        command: strip_prog.found()
            ? [strip_prog, '--strip-all', '-o', '@OUTPUT@', onnxruntime_built]
            : [find_program('cp'), onnxruntime_built, '@OUTPUT@'],
        build_by_default: true,
    )
endif

# ----------------------------------------------------------------------------
# On darwin every GNOME library resolves against the HOST PROCESS and is NOT
# recorded as an `@rpath/` dependency. A Mach-O keys each dependency by the path
# that resolves it, so an `LC_RPATH` entry carrying its own copy gives the
# process a SECOND GLib: two GType registries, then SIGSEGV.
# docs/prebuilds.md § One GLib.
#
# `glib_deps` keeps the unstripped form — the test executables below are their
# own host process and link GLib for real.
# ----------------------------------------------------------------------------
host_provided = ['glib-2.0', 'gobject-2.0']

glib_deps = []
vala_deps = []
foreach pkg : host_provided
    dep = dependency(pkg)
    glib_deps += dep
    vala_deps += is_darwin \
        ? dep.partial_dependency(compile_args: true, includes: true) \
        : dep
endforeach

c_args = []
link_args = []

if is_darwin
    link_args += [
        # The other half of the host-GLib arrangement: the GNOME symbols the
        # stripped dependencies no longer link stay undefined here and are bound
        # by dyld to the copy the host already loaded.
        '-Wl,-undefined,dynamic_lookup',
        # Only this library's own API leaves it. Mach-O has a two-level
        # namespace, so this is about size and tidiness rather than the
        # correctness problem it is on ELF (below) — `-dead_strip` can drop
        # every sherpa-onnx and onnxruntime function the shim does not reach
        # once they are not exported, and that is most of the image.
        '-Wl,-exported_symbol,_gjsify_sherpa_*',
        '-Wl,-dead_strip',
        '-Wl,-dead_strip_dylibs',
        # Drops the debug map, whose N_OSO entries carry object-file mtimes.
        '-Wl,-S',
        # Room for the rpaths stage-prebuild.mjs rewrites; fixed at link time.
        '-Wl,-headerpad_max_install_names',
    ]
else
    # ELF HAS ONE FLAT SYMBOL NAMESPACE, so hiding the vendored engines is not
    # an optimisation here, it is correctness. An exported `OrtGetApiBase` in
    # this library would interpose on — or be interposed by — any other
    # onnxruntime the process loads, and the development host ships
    # libonnxruntime.so.1 (1.22.2) against the 1.28.2 compiled in here.
    # --exclude-libs makes every symbol from a static archive local, the version
    # script exports this library's API and nothing else, and
    # test/check-elf-deps.py reads both back from the built file.
    version_script = root_dir / 'src' / 'c' / 'gjsify-sherpa.map'
    link_args += [
        '-Wl,--exclude-libs,ALL',
        '-Wl,--version-script=' + version_script,
        '-Wl,--gc-sections',
        '-Wl,--as-needed',
        # `--strip-all`, where the sibling bridges use `--strip-debug`, and the
        # difference is worth 6 MB of the 33 this library weighs: the engines are
        # compiled in, so its `.symtab` is sherpa-onnx's and onnxruntime's
        # complete static symbol table, and nothing reads it. `.dynsym` is
        # untouched by this — it is what the dynamic linker binds and what
        # test/check-elf-deps.py reads back — so the exports and the
        # engine-hiding this file is careful about are measured exactly as
        # before. This is the largest native artifact in the repo by some way,
        # and it is the npm tarball a consumer downloads.
        '-Wl,--strip-all',
    ]
    c_args += ['-ffunction-sections', '-fdata-sections']
    vala_deps += [cc.find_library('m'), cc.find_library('dl', required: false)]

    # The final link is ours, not sherpa-onnx's, so the C++ runtime choice made
    # above has to be repeated here — the CMake subproject's flags apply to its
    # own objects. See § THE LIBSTDC++ DECISION.
    if have_static_libstdcxx
        link_args += ['-static-libstdc++', '-static-libgcc']
    endif
endif

vala_deps += dependency('threads')

# The library has to be findable beside its typelib — what
# check-prebuild-loader-path.mjs enforces on every shipped prebuild.
rpath = is_darwin ? '@loader_path' : '$ORIGIN'

shim_inc = include_directories('src/c')

# ----------------------------------------------------------------------------
# The shim as its own static library, so that its OBJECTS exist as a thing both
# the shared library and the C test can pull in.
#
# `extract_all_objects()` is why. The smoke test links the shim's objects rather
# than the shared library, to get underneath the version script that exists to
# hide the engines (test/shim-smoke.c says so at the top). Extracting from a
# target with VALA sources does not work: meson lists the Vala-generated
# `.c.o` files among the objects, but ninja has no rule that builds them outside
# the library target, so the test fails to configure with "missing and no known
# rule to make it". A C-only target has no such problem — which is how
# packages/web/gamepad-native gets away with extracting from its library
# directly.
#
# The shared library takes the objects, NOT `link_whole`. An archive on the link
# line is what `-Wl,--exclude-libs,ALL` (above) acts on, and it would make every
# shim symbol local; as plain objects they stay subject to the version script,
# which is the single place this library's exports are decided.
# ----------------------------------------------------------------------------
shim = static_library('gjsify-sherpa-shim', 'src/c/gjsify-sherpa-shim.c',
    dependencies: glib_deps + [sherpa_dep],
    include_directories: [sherpa_inc, shim_inc],
    c_args: c_args,
    pic: true,
)

sources = files(
    'src/vala/sherpa.vala',
    'src/vala/vad.vala',
    'src/vala/online-recognizer.vala',
    'src/vala/offline-recognizer.vala',
)

libGjsifySherpa = library('gjsifysherpa', sources,
    objects: shim.extract_all_objects(recursive: false),
    dependencies: vala_deps + [sherpa_dep],
    include_directories: [sherpa_inc, shim_inc],
    c_args: c_args,
    link_args: link_args,
    link_depends: is_linux ? files('src/c/gjsify-sherpa.map') : [],
    vala_args: [
        # The shim's VAPI is not installed and not a pkg-config package: it
        # describes C that is compiled into this very library (src/c), so valac
        # is pointed at the source directory rather than at a vapi search path.
        '--vapidir=' + root_dir / 'src/vala',
        '--pkg=sherpa-shim',
        # valac emits `#include "gjsify-sherpa-shim.h"` from the VAPI's
        # cheader_filename; src/c is on the include path above.
    ],
    vala_gir: meson.project_name() + '-1.0.gir',
    # The engines are C++ archives; without this meson links with the C driver
    # and the C++ runtime is simply absent. See the note on project() above.
    link_language: 'cpp',
    install: true,
    install_dir: [true, true, true, true],
    install_rpath: rpath,
    build_rpath: rpath,
)

# ----------------------------------------------------------------------------
# Host-dependent shared-library leaf name.
#
# The typelib records the exact filename g_module_open() resolves at load time,
# and meson names the library per host convention. Recording the wrong leaf
# yields a typelib that IS found via GI_TYPELIB_PATH but whose library never
# loads — a silent failure. Mirrors packages/node/sqlite-native/meson.build.
# ----------------------------------------------------------------------------
shared_lib_name = is_darwin ? 'libgjsifysherpa.dylib' : 'libgjsifysherpa.so'

g_ir_compiler = find_program('g-ir-compiler', 'gi-compile-repository')

typelib = custom_target(meson.project_name() + '-1.0.typelib',
    command: [
        g_ir_compiler,
        '--shared-library', shared_lib_name,
        '--output', '@OUTPUT@',
        meson.current_build_dir() / meson.project_name() + '-1.0.gir',
    ],
    output: meson.project_name() + '-1.0.typelib',
    depends: libGjsifySherpa,
    install: true,
    install_dir: get_option('libdir') / 'girepository-1.0',
)

# ----------------------------------------------------------------------------
# Tests.
#
# NOTHING HERE DOWNLOADS A MODEL and nothing here opens an audio device. The
# models are hundreds of megabytes under licences that are not this repo's to
# redistribute (ADR 0127 decision 14), so what a model-less runner can prove is
# what runs by default: the engines are linked and answer, a missing model is
# refused by path rather than by crash, and — on ELF — that the vendored
# onnxruntime is invisible from outside the library.
#
# The one test that needs a real Silero model is registered too and SKIPS (exit
# 77) unless one is cached, so the gap is visible in the test report instead of
# being absent from it. It exists because opening a session is the ONLY thing
# that saw the static-onnxruntime heap corruption — see test/vad-model.gjs.js.
# ----------------------------------------------------------------------------
# `$ORIGIN` for the same reason the library has it: the engine is recorded by
# its unversioned SONAME, so the only thing that resolves it is the staged copy
# sitting beside the binary — and this executable is in the build root next to
# it. meson adds the build directory to an executable's rpath for the LIBRARY
# TARGETS it links; libonnxruntime.so arrives as a custom_target output, which
# meson has no way to know is a library, hence both the rpath and the `depends`.
smoke = executable('shim-smoke', 'test/shim-smoke.c',
    objects: shim.extract_all_objects(recursive: false),
    dependencies: glib_deps + vala_deps + [sherpa_dep],
    include_directories: [sherpa_inc, shim_inc],
    link_language: 'cpp',
    build_rpath: rpath,
)
test('shim-smoke', smoke,
     timeout: 120,
     depends: is_linux ? [onnxruntime_staged] : [])

python3 = find_program('python3', required: false)
if is_linux and python3.found()
    # The export and dependency read-back. python3 is `required: false` for the
    # reason every optional tool in this repo's meson files is: a host without
    # it must get a tree that builds with a test SKIPPED, not a configure error.
    #
    # The flag is passed only when libstdc++.a was actually found, so this
    # asserts "no libstdc++.so.6 in DT_NEEDED" exactly on the builds where that
    # is supposed to be true — and does not red a working non-shippable build.
    elf_deps_args = [files('test/check-elf-deps.py'), libGjsifySherpa.full_path()]
    if have_static_libstdcxx
        elf_deps_args += ['--require-static-libstdcxx']
    endif
    # Same shape, one level down: the engine is only expected to be stripped on a
    # build that had a `strip` to do it with.
    if strip_prog.found()
        elf_deps_args += ['--require-stripped-engine']
    endif
    # `onnxruntime_staged` is in `depends` because this test reads that file too
    # — the sibling, its exports, its GLIBCXX floor and now its `.symtab`. It is
    # `build_by_default`, so a full build has it either way; naming it is what
    # makes `meson test elf-deps` on its own true as well.
    test('elf-deps', python3,
         args: elf_deps_args,
         depends: [libGjsifySherpa, onnxruntime_staged])
endif

# The same engines through the typelib under gjs — i.e. the GIR this package's
# TypeScript actually imports. The build directory holds both the typelib and
# the library its `shared-library` names.
gjs = find_program('gjs', required: false)
if gjs.found()
    # LD_LIBRARY_PATH as well as the rpath: the typelib names
    # `libgjsifysherpa.so` and gjs resolves that from the process, not from a
    # $ORIGIN the process does not have. It is also what finds the staged
    # libonnxruntime.so beside it.
    gjs_env = {
        'GI_TYPELIB_PATH': meson.current_build_dir(),
        'DYLD_LIBRARY_PATH': meson.current_build_dir(),
        'LD_LIBRARY_PATH': meson.current_build_dir(),
    }

    gjs_depends = [libGjsifySherpa, typelib]
    if is_linux
        gjs_depends += onnxruntime_staged
    endif

    test('api-gjs', gjs,
         args: ['-m', files('test/api.gjs.js')],
         depends: gjs_depends,
         timeout: 120,
         env: gjs_env)

    # SKIPs (exit 77) without a cached model. `env` ADDS to the environment the
    # test runner inherits, so GJSIFY_SHERPA_VAD_MODEL reaches the script
    # without being named here.
    test('vad-model-gjs', gjs,
         args: ['-m', files('test/vad-model.gjs.js')],
         depends: gjs_depends,
         timeout: 180,
         env: gjs_env)
endif

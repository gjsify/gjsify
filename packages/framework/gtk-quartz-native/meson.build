# GjsifyQuartz — a Dock click reopens the application on macOS (ADR 0141).
#
# Objective-C because the fix is a method added through the ObjC runtime. It
# links NEITHER GTK nor GLib: the class is looked up by name at run time (a host
# without GTK loaded just finds nothing), and GLib/GIO bind to the host process
# (docs/prebuilds.md § One GLib).
# `buildtype=plain` = no `-g`, so a rebuild is byte-identical (docs/prebuilds.md).
project('GjsifyQuartz', ['c', 'objc'], version: '1.0',
        default_options: ['c_std=c11', 'buildtype=plain'])

if host_machine.system() != 'darwin'
    error('GjsifyQuartz patches GTK\'s Quartz backend and only builds on darwin.')
endif

gnome = import('gnome')
fs = import('fs')

host_provided = ['glib-2.0', 'gobject-2.0', 'gio-2.0']
dependencies = []
foreach pkg : host_provided
    dependencies += dependency(pkg).partial_dependency(
        compile_args: true, includes: true)
endforeach

# The deployment target comes from MACOSX_DEPLOYMENT_TARGET (the 15.0 floor,
# ADR 0074) exactly as for the Vala bridges; no copy of it lives here.
add_project_arguments(['-fobjc-arc'], language: 'objc')

sources = files('src/objc/gjsify-quartz.m')
headers = files('src/objc/gjsify-quartz.h')

libgjsifyquartz = library('gjsifyquartz', sources,
    dependencies: dependencies,
    link_args: ['-Wl,-undefined,dynamic_lookup', '-framework', 'Foundation'],
    install: true,
    install_rpath: '@loader_path',
    build_rpath: '@loader_path',
)

gir = gnome.generate_gir(libgjsifyquartz,
    sources: headers,
    namespace: 'GjsifyQuartz',
    nsversion: '1.0',
    identifier_prefix: 'GjsifyQuartz',
    symbol_prefix: 'gjsify_quartz',
    includes: ['GLib-2.0'],
    header: 'gjsify-quartz.h',
    install: true,
    install_dir_gir: get_option('datadir') / 'gir-1.0',
    install_dir_typelib: get_option('libdir') / 'girepository-1.0',
    extra_args: ['--quiet', '--warn-all'],
)

# ---------------------------------------------------------------------------
# Tests. The Objective-C one is the ADR's spec: it needs to SEND the selector,
# which GJS cannot. The gjs one proves the typelib + library load and that the
# entry point is callable through GI.
# ---------------------------------------------------------------------------
gtk_dep = dependency('gtk4')
gio_dep = dependency('gio-2.0')
reopen_test = executable('reopen-handler', 'test/reopen-handler.m',
    dependencies: [gtk_dep, gio_dep],
    link_with: libgjsifyquartz,
    link_args: ['-framework', 'Foundation'],
)
test('reopen-handler', reopen_test)

gjs = find_program('gjs', required: false)
if gjs.found()
    test('install-gjs', gjs,
         args: ['-m', files('test/install.gjs.js')],
         depends: [libgjsifyquartz, gir],
         env: {
             'GI_TYPELIB_PATH': meson.current_build_dir(),
             'DYLD_LIBRARY_PATH': meson.current_build_dir(),
         })
endif

export default {
    environments: ['gjs'],
    modules: ['Gio-2.0', 'GLib-2.0', 'GTop-2.0', 'Soup-3.0', 'Gtk-4.0', 'Gwebgl*'],
    girDirectories: ['/usr/share/gir-1.0', '../../web/webgl/build'],
    ignoreVersionConflicts: true,
    promisify: true,
    noDOMLib: true,
    ignore: []
}

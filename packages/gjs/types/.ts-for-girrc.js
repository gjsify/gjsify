export default {
    environments: ['gjs'],
    modules: ['Gwebgl*'],
    girDirectories: ['/usr/share/gir-1.0', '../../web/webgl/build'],
    ignoreVersionConflicts: true,
    promisify: true,
    noDOMLib: true,
    package: true,
    packageYarn: false,
    ignore: []
}

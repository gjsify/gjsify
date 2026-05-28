import GLib from '@girs/glib-2.0';

// `imports.byteArray` is GJS-only and undefined under Node. Access lazily inside
// the function body (called only on GJS) so the module's top level stays free
// of a hard `imports` reference — keeps node-target bundles loadable.

export const cli = (commandLine: string): string => {
    const [_res, out, err, _status] = GLib.spawn_command_line_sync(commandLine);

    if (err.byteLength) throw new Error(imports.byteArray.toString(err));

    return imports.byteArray.toString(out);
};

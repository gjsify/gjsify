import GLib from '@girs/glib-2.0';
const byteArray = imports.byteArray;

export const cli = (commandLine: string): string => {
    const [_res, out, err, _status] = GLib.spawn_command_line_sync(commandLine);

    if (err.byteLength) throw new Error(byteArray.toString(err));

    return byteArray.toString(out);
};

import GLib from '@girs/glib-2.0';

// TextDecoder, not the legacy `imports.byteArray.toString()` — see ./file.ts.
const decoder = new TextDecoder();

export const cli = (commandLine: string): string => {
    const [_res, out, err, _status] = GLib.spawn_command_line_sync(commandLine);

    if (err.byteLength) throw new Error(decoder.decode(err));

    return decoder.decode(out);
};

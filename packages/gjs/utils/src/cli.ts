import GLib from '@girs/glib-2.0';

// Standard `TextDecoder` instead of the legacy `imports.byteArray.toString()` —
// see the note in `./file.ts`.
const decoder = new TextDecoder();

export const cli = (commandLine: string): string => {
    const [_res, out, err, _status] = GLib.spawn_command_line_sync(commandLine);

    if (err.byteLength) throw new Error(decoder.decode(err));

    return decoder.decode(out);
};

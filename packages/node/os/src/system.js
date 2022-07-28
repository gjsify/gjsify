import GLib from 'gi://GLib';
const byteArray = imports.byteArray;

export default (commandLine) => {
    const [res, out, err, status] = GLib.spawn_command_line_sync(commandLine);

    if(err.byteLength) throw new Error(byteArray.toString(err));

    return byteArray.toString(out);
};

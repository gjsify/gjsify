import GLib from '@gjsify/types/GLib-2.0';
const byteArray = imports.byteArray;

export const cli = (commandLine: string) => {
    const [res, out, err, status] = GLib.spawn_command_line_sync(commandLine);
  
    if(err.byteLength) throw new Error(byteArray.toString(err));
  
    return byteArray.toString(out);
};
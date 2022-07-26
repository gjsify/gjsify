import GLib from 'gi://GLib';
const trim = ''.trim;
export default (o_O) => trim.call(GLib.spawn_command_line_sync(o_O)[1]);

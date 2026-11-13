// The typelib + library load under gjs and the entry point is callable through GI.
// Plain JS on purpose: meson runs it before any TypeScript of this repo is built.
import Gtk from 'gi://Gtk?version=4.0';
import GjsifyQuartz from 'gi://GjsifyQuartz?version=1.0';

function assert(condition, message) {
    if (!condition) throw new Error(`assertion failed: ${message}`);
}

// Gtk must be loaded so GtkApplicationQuartzDelegate is registered.
assert(typeof Gtk.Application === 'function', 'Gtk loaded');
const first = GjsifyQuartz.install_reopen_handler();
assert(typeof first === 'boolean', 'install_reopen_handler() returns a boolean');
assert(GjsifyQuartz.install_reopen_handler() === false, 'a second call installs nothing');
console.log(`install.gjs: first=${first}, second=false, ok`);

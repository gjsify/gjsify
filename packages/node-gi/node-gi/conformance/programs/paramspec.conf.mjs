// SPDX-License-Identifier: MIT
// GParamSpec wrapping (phase 2.7a) via headless Gio (no test typelib needed). A
// `notify` handler's SECOND argument is a real GObject.ParamSpec — read its
// name/get_name()/nick, resolve value_type/owner_type to their GType names, and
// verify the readable/writable flag bits + `instanceof GObject.ParamSpec`. The
// golden is the gjs output; node/bun/deno must match it byte-for-byte.
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';

const action = new Gio.SimpleAction({ name: 'demo', enabled: true });

let fired = false;
action.connect('notify::enabled', (obj, pspec) => {
  fired = true;
  print('name:', pspec.name);
  print('get_name():', pspec.get_name());
  print('nick:', pspec.nick);
  print('value_type:', GObject.type_name(pspec.value_type));
  print('owner_type:', GObject.type_name(pspec.owner_type));
  // Semantic flag bits (a raw flags int can drift across GLib versions).
  print('readable:', Boolean(pspec.flags & GObject.ParamFlags.READABLE));
  print('writable:', Boolean(pspec.flags & GObject.ParamFlags.WRITABLE));
  print('instanceof ParamSpec:', pspec instanceof GObject.ParamSpec);
});

action.set_enabled(false);
print('handler fired:', fired);

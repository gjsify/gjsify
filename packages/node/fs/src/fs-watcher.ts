import Gio from '@girs/gio-2.0';
import { EventEmitter } from 'events';
const privates = new WeakMap;

import type { FSWatcher as IFSWatcher } from 'fs';

export class FSWatcher extends EventEmitter implements IFSWatcher {

  constructor(filename: string, options, listener) {
    super();
    if (!options || typeof options !== 'object')
      options = {persistent: true};

    const cancellable = Gio.Cancellable.new();
    const file = Gio.File.new_for_path(filename);
    const watcher = file.monitor(Gio.FileMonitorFlags.NONE, cancellable);
    watcher.connect('changed', changed.bind(this));

    privates.set(this, {
      persistent: options.persistent,
      cancellable,
      // even if never used later on, the monitor needs to be
      // attached to this instance or GJS reference counter
      // will ignore it and no watch will ever happen
      watcher
    });
    if (listener) this.on('change', listener);
    // TODO: if (options.persistent) mainloop.wait();
  }

  close() {
    const {cancellable, persistent} = privates.get(this);
    if (!cancellable.is_cancelled()) {
      cancellable.cancel();
      // TODO: if (persistent) mainloop.go();
    }
  }

};

function changed(watcher, file, otherFile, eventType) {
  switch (eventType) {
    case Gio.FileMonitorEvent.CHANGES_DONE_HINT:
      this.emit('change', 'change', file.get_basename());
      break;
    case Gio.FileMonitorEvent.DELETED:
    case Gio.FileMonitorEvent.CREATED:
    case Gio.FileMonitorEvent.RENAMED:
    case Gio.FileMonitorEvent.MOVED_IN:
    case Gio.FileMonitorEvent.MOVED_OUT:
      this.emit('rename', 'rename', file.get_basename());
      break;
  }
}

export default FSWatcher;
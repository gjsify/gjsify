import { getProgramExe } from '@gjsify/utils';
import { EventEmitter } from 'events';
import { arch, platform } from 'os';
import GLib from '@gjsify/types/GLib-2.0';
import Gio from '@gjsify/types/Gio-2.0';

const File = Gio.File;
const System = imports.system;
const TIME = Date.now();

class Process extends EventEmitter {
  constructor() {
    super();
  }

   // lazy own properties
   get arch() {
    return arch();
  }

  get argv() {
    const fs = require('fs');
    const arr = [ getProgramExe() ];
    ARGV.forEach(arg => {
      if (arg[0] !== '-') {
        arr.push(
          fs.existsSync(arg) ?
            File.new_for_path(arg).get_path() :
            arg
        );
      } else {
        arr.push(arg);
      }
    });
    return arr;
  }

  get argv0() {
    return  File.new_for_path(getProgramExe()).get_basename();
  }

  get env() {
    return GLib.listenv().reduce(
      (env, key) => {
        env[key] = GLib.getenv(key);
        return env;
      },
      {}
    );
  }

  get pid() {
    return new Gio.Credentials().get_unix_pid();
  }

  get platform() {
    return platform();
  }

  get title() {
    return GLib.get_prgname();
  }

  get version() {
    return String(System.version); // TODO: use `gjs --version`
  }

  get versions() {
    return {
      gjs: process.version,
      node: "0.0.0"
      // TODO: version dependencies
    }
  }

  abort() {
    process.emit('abort');
    System.exit(1);
  }

  cwd() {
    return GLib.get_current_dir();
  }

  exit(status: number) {
    process.emit('exit', status);
    System.exit(status || 0);
  }

  nextTick() {
    setImmediate.apply(null, arguments);
  }

  uptime() {
    return (Date.now() - TIME) / 1000;
  }
}

/** https://nodejs.org/api/process.html#process_process */
const process = new Process();

export default process;

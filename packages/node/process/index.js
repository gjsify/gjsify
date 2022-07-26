import { getProgramExe } from '@gjsify/utils';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const File = Gio.File;
const System = imports.system;
const TIME = Date.now();
const EventEmitter = require('events').EventEmitter;

const lazy = (key, value) =>
  Object.defineProperty(process, key, {
    enumerable: true,
    value: value
  })[key];

const process = Object.defineProperties(
  new EventEmitter,
  Object.getOwnPropertyDescriptors({

    // lazy own properties
    get arch() {
      return lazy('arch', require('os').arch());
    },
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
      return lazy('argv', arr);
    },
    get argv0() {
      return lazy('argv0', File.new_for_path(getProgramExe()).get_basename());
    },
    get env() {
      return lazy('env', GLib.listenv().reduce(
        (env, key) => {
          env[key] = GLib.getenv(key);
          return env;
        },
        {}
      ));
    },
    get pid() {
      return lazy('pid', new Gio.Credentials().get_unix_pid());
    },
    get platform() {
      return lazy('platform', require('os').platform());
    },
    get title() {
      return lazy('title', GLib.get_prgname());
    },
    get version() {
      return lazy('version', String(System.version)); // TODO: use `gjs --version`
    },
    get versions() {
      return lazy('versions', Object.assign(
        {
          gjs: process.version,
          node: "16.0.0"
        },
        [] // TODO GJSIFY_DEPS,
      ));
    },

    // methods
    abort() {
      process.emit('abort');
      System.exit(1);
    },
    cwd() {
      return GLib.get_current_dir();
    },
    exit(status) {
      process.emit('exit', status);
      System.exit(status || 0);
    },
    nextTick() {
      setImmediate.apply(null, arguments);
    },
    uptime() {
      return (Date.now() - TIME) / 1000;
    }
  })
);

export default process;

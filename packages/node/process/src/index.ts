import { getProgramExe } from '@gjsify/utils';
import { EventEmitter } from 'events';
import { arch as _arch, platform as _platform  } from 'os';
import { WriteStream, ReadStream } from 'tty';
import * as fs from 'fs';

import imports from '@gjsify/types/index';
import GLib from '@gjsify/types/GLib-2.0';
import Gio from '@gjsify/types/Gio-2.0';
import { hrtime } from "./hrtime.js";

const File = Gio.File;
const System = imports.system;
const TIME = Date.now();

class Process extends EventEmitter {

  hrtime = hrtime.bind(this);

  // TODO
  stdout = new WriteStream(0);

  // TODO
  stderr = new WriteStream(0);

  // TODO
  stdin = new ReadStream(0);

  protected _startTime = Date.now();

  constructor() {
    super();
  }

  _listenerCount (eventName: string) {
    return this.listeners(eventName).length
  }

  get arch() {
    return _arch();
  }

  get argv() {
    const arr: string[] = [ getProgramExe().get_path() ];
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
    return File.new_for_path(getProgramExe().get_path()).get_basename();
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
    return _platform();
  }

  get title() {
    return GLib.get_prgname();
  }

  get version() {
    return String(System.version); // TODO: use `gjs --version`
  }

  get versions() {
    return {
      gjs: this.version,
      http_parser: '0.0',
      node: '0.0',
      v8: '0.0',
      uv: '0.0',
      zlib: '0.0',
      ares: '0.0',
      icu: '0.0',
      modules: '0',
      openssl: '0.0'
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

  nextTick(cb: Function, ...args: any[]) {
    if (typeof cb !== 'function') {
      throw new TypeError('handler is not a function')
    }

    setImmediate.apply(null, arguments);
  }

  uptime() {
    return Math.floor((Date.now() - this._startTime) / 1000)
  }

  memoryUsage () {
    return {
      rss: 0,
      heapTotal: Number.MAX_SAFE_INTEGER,
      heapUsed: 0,
      external: 0
    }
  }

}

/** https://nodejs.org/api/process.html#process_process */
const process = new Process();

export default process;

export {
  hrtime,
}

export const stdout = process.stdout;
export const stderr = process.stderr;
export const stdin = process.stdin;
export const arch = process.arch;
export const argv = process.argv;
export const argv0 = process.argv0;
export const env = process.env;
export const pid = process.pid;
export const platform = process.platform;
export const title = process.title;
export const version = process.version;
export const versions = process.versions;
export const abort = process.abort;
export const cwd = process.cwd;
export const exit = process.exit;
export const nextTick = process.nextTick;
export const uptime = process.uptime;
export const memoryUsage = process.memoryUsage;
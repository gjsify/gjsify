import GLib from '@gjsify/types/GLib-2.0';
import Gio from '@gjsify/types/Gio-2.0';
import { Buffer } from 'buffer';

import { getEncodingFromOptions } from './encoding.js';
import FSWatcher from './fs-watcher';
import { encodeUint8Array } from './encoding.js';
import { FileHandle } from './file-handle.js';

import type { PathLike, Mode } from './types/index.js';

export function existsSync(path: string) {
  // TODO: accept buffer and URL too
  if (typeof path !== 'string' || path === '') {
    return false;
  }

  const file = Gio.File.new_for_path(path);
  return file.query_exists(null);
}

export function readdirSync(path: string, options: BufferEncoding = 'utf8') {
  const encoding = getEncodingFromOptions(options);
  const dir = Gio.File.new_for_path(path);
  const list = [];

  const enumerator = dir.enumerate_children('standard::*', 0, null);
  let info = enumerator.next_file(null);

  while (info) {
    const child = enumerator.get_child(info);
    const fileName = child.get_basename();

    if (encoding === 'buffer') {
      const encodedName = Buffer.from(fileName);
      list.push(encodedName);
    } else {
      const encodedName = Buffer.from(fileName).toString(encoding);
      list.push(encodedName);
    }

    info = enumerator.next_file(null);
  }

  return list;
}

export function readFileSync(path: string, options = { encoding: null, flag: 'r' }) {
  const file = Gio.File.new_for_path(path);

  const [ok, data] = file.load_contents(null);

  if (!ok) {
    // TODO: throw a better error
    throw new Error('failed to read file');
  }

  return encodeUint8Array(options, data);
}

export function mkdirSync(path: string, mode = 0o777) {
  if (GLib.mkdir_with_parents(path, mode) !== 0) {
    // TODO: throw a better error
    throw new Error(`failed to make ${path} directory`);
  }
}

export function rmdirSync(path: string) {
  const result = GLib.rmdir(path);

  if (result !== 0) {
    // TODO: throw a better error
    throw new Error(`failed to remove ${path} directory`);
  }
}

export function unlinkSync(path: string) {
  GLib.unlink(path);
}

export function writeFileSync(path: string, data: any) {
  GLib.file_set_contents(path, data);
}

export function watch(filename: string, options, listener) {
  return new FSWatcher(filename, options, listener);
}

export function openSync(path: PathLike, flags?: string | number, mode?: Mode): FileHandle {
  return new FileHandle(path);
}

import imports from '@gjsify/types/index';
import GLib from '@gjsify/types/GLib-2.0';
import Gio from '@gjsify/types/Gio-2.0';
import { Buffer } from 'buffer';

import FSWatcher from './fs-watcher';
import { createReadStream, ReadStream } from './fs-read-streams.js';

const byteArray = imports.byteArray;

function getEncodingFromOptions(options, defaultEncoding = 'utf8') {
  if (options === null) {
    return defaultEncoding;
  }

  if (typeof options === 'string') {
    return options;
  }

  if (typeof options === 'object' && typeof options.encoding === 'string') {
    return options.encoding;
  }

  return defaultEncoding;
}

function existsSync(path: string) {
  // TODO: accept buffer and URL too
  if (typeof path !== 'string' || path === '') {
    return false;
  }

  const file = Gio.File.new_for_path(path);
  return file.query_exists(null);
}

function readdirSync(path: string, options = 'utf8') {
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

function readFileSync(path: string, options = { encoding: null, flag: 'r' }) {
  const file = Gio.File.new_for_path(path);

  const [ok, data] = file.load_contents(null);

  if (!ok) {
    // TODO: throw a better error
    throw new Error('failed to read file');
  }

  const encoding = getEncodingFromOptions(options, 'buffer');
  if (encoding === 'buffer') {
    return Buffer.from(data);
  }

  // TODO encoding
  return byteArray.toString(data);
}

function mkdirSync(path: string, mode = 0o777) {
  if (GLib.mkdir_with_parents(path, mode) !== 0) {
    // TODO: throw a better error
    throw new Error(`failed to make ${path} directory`);
  }
}

function rmdirSync(path: string) {
  const result = GLib.rmdir(path);

  if (result !== 0) {
    // TODO: throw a better error
    throw new Error(`failed to remove ${path} directory`);
  }
}

function unlinkSync(path: string) {
  GLib.unlink(path);
}

function writeFileSync(path: string, data) {
  GLib.file_set_contents(path, data);
}

function watch(filename: string, options, listener) {
  return new FSWatcher(filename, options, listener);
}

export {
  FSWatcher,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmdirSync,
  unlinkSync,
  watch,
  createReadStream,
  ReadStream
};


export default {
  FSWatcher,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmdirSync,
  unlinkSync,
  watch,
  createReadStream,
  ReadStream
};
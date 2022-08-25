import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmdirSync, unlinkSync, watch } from './sync.js';
import { open, close, read, write, rm } from './callback.js';
import FSWatcher from './fs-watcher';
import { createReadStream, ReadStream } from './read-stream.js';
import * as promises from './promises.js';

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
  ReadStream,
  promises,
  open,
  close,
  read,
  write,
  rm,
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
  ReadStream,
  promises,
  open,
  close,
  read,
  write,
  rm,
};
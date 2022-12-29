import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmdirSync, unlinkSync, watch, mkdtempSync, rmSync, statSync } from './sync.js';
import { open, close, read, write, rm } from './callback.js';
import FSWatcher from './fs-watcher.js';
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
  mkdtempSync,
  rmSync,
  statSync,
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
  mkdtempSync,
  rmSync,
  statSync,
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
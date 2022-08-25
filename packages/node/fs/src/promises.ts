import Gio from '@gjsify/types/Gio-2.0';
import { warnNotImplemented } from '@gjsify/utils';
import { encodeUint8Array } from './encoding.js';
import { readdirSync, writeFileSync, mkdirSync, rmdirSync, unlinkSync } from './sync.js';
import { FileHandle } from './file-handle.js';

import type { PathLike, Mode, ObjectEncodingOptions, OpenMode, ReadOptions } from './types/index.js';

async function mkdir(path: string, mode = 0o777) {
  // TODO async
  return mkdirSync(path, mode);
}
async function readdir(path: string) {
  // TODO async
  return readdirSync(path);
}

async function readFile(path: PathLike | FileHandle, options: ReadOptions = { encoding: null, flag: 'r' }) {
  const file = Gio.File.new_for_path(path.toString());

  const [ok, data] = await new Promise<[boolean, Uint8Array, string]>((resolve, reject) => {
    file.load_contents_async(null, (self, res) => {
      resolve(file.load_contents_finish(res));
    });
  });

  if (!ok) {
    // TODO: throw a better error
    throw new Error('failed to read file');
  }

  return encodeUint8Array(options, data);
}

async function writeFile(path: string, data: any) {
  // TODO async
  return writeFileSync(path, data);
}

async function rmdir(path: string) {
  // TODO async
  return rmdirSync(path);
}

async function unlink(path: string) {
  // TODO async
  return unlinkSync(path);
}

async function open(path: PathLike, flags?: string | number, mode?: Mode): Promise<FileHandle> {
  return new FileHandle(path);
}

async function write<TBuffer extends Uint8Array>(
  fd: number,
  buffer: TBuffer,
  offset?: number | null,
  length?: number | null,
  position?: number | null
): Promise<{
  bytesWritten: number;
  buffer: TBuffer;
}>

async function write(
  fd: number,
  data: string,
  position?: number | null,
  encoding?: BufferEncoding | null
): Promise<{
  bytesWritten: number;
  buffer: string;
}>

async function write<TBuffer extends Uint8Array>(
  fd: number,
  data: string | TBuffer,
  positionOrOffset?: number | null,
  encodingOrLength?: BufferEncoding | null | number,
  position?: number | null
): Promise<{
  bytesWritten: number;
  buffer: string;
}> {
  if(typeof data === 'string') {
    return _writeStr(fd, data, positionOrOffset, encodingOrLength as BufferEncoding | null);
  }
  return _writeBuf<any>(fd, data, positionOrOffset as number | null, encodingOrLength as  null | number, position);
}

async function _writeBuf<TBuffer extends Uint8Array>(
  fd: number,
  buffer: TBuffer,
  offset?: number | null,
  length?: number | null,
  position?: number | null
): Promise<{
  bytesWritten: number;
  buffer: TBuffer;
}> {
  warnNotImplemented("fs.promises.write");
  return {
    bytesWritten: 0,
    buffer
  }
}

async function _writeStr(
  fd: number,
  data: string,
  position?: number | null,
  encoding?: BufferEncoding | null
): Promise<{
  bytesWritten: number;
  buffer: string;
}> {
  warnNotImplemented("fs.promises.write");
  return {
    bytesWritten: 0,
    buffer: data,
  }
}

export {
  readFile,
  mkdir,
  readdir,
  writeFile,
  rmdir,
  unlink,
  open,
  write,
};

export default {
  readFile,
  mkdir,
  readdir,
  writeFile,
  rmdir,
  unlink,
  open,
  write,
};
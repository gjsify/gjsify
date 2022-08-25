import imports from '@gjsify/types/index';
const byteArray = imports.byteArray;
import type { ReadOptions, ObjectEncodingOptions, BufferEncodingOption } from './types/index.js'

export function getEncodingFromOptions(options: ReadOptions | ObjectEncodingOptions | BufferEncodingOption= { encoding: null, flag: 'r' }, defaultEncoding: BufferEncoding | "buffer" = 'utf8'): BufferEncoding | 'buffer' {
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

export function encodeUint8Array(options: ReadOptions = { encoding: null, flag: 'r' }, data: Uint8Array) {
  const encoding = getEncodingFromOptions(options, 'buffer');

  if (encoding === 'buffer') {
    return Buffer.from(data);
  }

  // TODO more encodings
  return byteArray.toString(data);
}
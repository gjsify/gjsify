import imports from '@gjsify/types/index';
const byteArray = imports.byteArray;
import type { ReadOptions, ObjectEncodingOptions, BufferEncodingOption } from './types/index.js'

export function getEncodingFromOptions(options: ReadOptions | ObjectEncodingOptions | BufferEncodingOption= { encoding: null, flag: 'r' }, defaultEncoding: null | BufferEncoding | "buffer" = 'utf8'): BufferEncoding | 'buffer' {
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

export function encodeUint8Array(encoding: BufferEncoding | 'buffer', data: Uint8Array) {
  if (encoding === 'buffer') {
    return Buffer.from(data);
  }

  const decoder = new TextDecoder(encoding);
  return decoder.decode(data);
  // return byteArray.toString(data);
}

// Credits https://github.com/denoland/deno_std/blob/63be40277264e71af60f9b118a2cb569e02beeab/node/_fs/_fs_mkdtemp.ts#L82
export function decode(str: string, encoding?: string): string {
  if (!encoding) return str;
  else {
    const decoder = new TextDecoder(encoding);
    const encoder = new TextEncoder();
    return decoder.decode(encoder.encode(str));
  }
}
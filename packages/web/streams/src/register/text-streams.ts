// Registers: TextEncoderStream, TextDecoderStream

import { TextEncoderStream, TextDecoderStream } from '../index.js';

/**
 * Typed view of the GJS global slots this register module installs.
 * Keeps the writes free of `as any` while tolerating their absence
 * during early bootstrap.
 */
interface _TextStreamsGlobals {
  TextEncoderStream?: typeof TextEncoderStream;
  TextDecoderStream?: typeof TextDecoderStream;
}

const g = globalThis as unknown as _TextStreamsGlobals;

if (typeof globalThis.TextEncoderStream === 'undefined') {
  g.TextEncoderStream = TextEncoderStream;
}
if (typeof globalThis.TextDecoderStream === 'undefined') {
  g.TextDecoderStream = TextDecoderStream;
}

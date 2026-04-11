// Registers: TextEncoderStream, TextDecoderStream

import { TextEncoderStream, TextDecoderStream } from '../index.js';

if (typeof globalThis.TextEncoderStream === 'undefined') {
  (globalThis as any).TextEncoderStream = TextEncoderStream;
}
if (typeof globalThis.TextDecoderStream === 'undefined') {
  (globalThis as any).TextDecoderStream = TextDecoderStream;
}

// stream/web — Re-export WHATWG Streams API
// Uses @gjsify/web-streams polyfill (provides native on Node.js, polyfill on GJS)

export {
  ReadableStream,
  WritableStream,
  TransformStream,
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
} from '@gjsify/web-streams';

import {
  ReadableStream,
  WritableStream,
  TransformStream,
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
} from '@gjsify/web-streams';

export default {
  ReadableStream,
  WritableStream,
  TransformStream,
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
};

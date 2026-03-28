# @gjsify/web-streams

GJS implementation of the Web Streams API (ReadableStream, WritableStream, TransformStream).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/web-streams
# or
yarn add @gjsify/web-streams
```

## Usage

```typescript
import { ReadableStream, WritableStream, TransformStream } from '@gjsify/web-streams';

const readable = new ReadableStream({
  start(controller) {
    controller.enqueue('hello');
    controller.close();
  }
});
```

## License

MIT

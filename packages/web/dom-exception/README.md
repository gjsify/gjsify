# @gjsify/dom-exception

GJS implementation of the Web DOMException API.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/dom-exception
# or
yarn add @gjsify/dom-exception
```

## Usage

```typescript
import { DOMException } from '@gjsify/dom-exception';

throw new DOMException('Operation not supported', 'NotSupportedError');
```

## License

MIT

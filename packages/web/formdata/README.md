# @gjsify/formdata

GJS implementation of the Web FormData and File APIs.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/formdata
# or
yarn add @gjsify/formdata
```

## Usage

```typescript
import { FormData, File } from '@gjsify/formdata';

const form = new FormData();
form.append('name', 'value');
form.append('file', new File(['content'], 'file.txt', { type: 'text/plain' }));
```

## License

MIT

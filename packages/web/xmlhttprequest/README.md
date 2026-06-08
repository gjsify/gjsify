# @gjsify/xmlhttprequest

XMLHttpRequest API for GJS backed by Soup 3.0 and GLib. Supports all `responseType` values (`arraybuffer`, `blob`, `json`, `text`), `file://` URLs (read directly via GLib), root-relative URL rewriting, and `URL.createObjectURL`/`revokeObjectURL` via temp files. Used as the asset loader backing for Excalibur.js on GJS.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/xmlhttprequest

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/xmlhttprequest
yarn add @gjsify/xmlhttprequest
```

## Usage

```typescript
import { XMLHttpRequest } from '@gjsify/xmlhttprequest';

const xhr = new XMLHttpRequest();
xhr.responseType = 'json';
xhr.open('GET', 'https://api.example.com/data.json');
xhr.onload = () => {
    console.log(xhr.response); // parsed JSON object
};
xhr.onerror = (e) => console.error('XHR error', e);
xhr.send();
```

## License

MIT

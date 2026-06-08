# @gjsify/domparser

A minimal `DOMParser.parseFromString` implementation (XML/HTML) with a small DOM surface — `tagName`, `getAttribute`, `children`, `querySelector`/`querySelectorAll`, `textContent`, `innerHTML`. Sized for excalibur-tiled and simple config parsing; runs on GJS, Node.js, and browsers (where the native `DOMParser` is used instead).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/domparser

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/domparser
yarn add @gjsify/domparser
```

## Usage

```typescript
import { DOMParser } from '@gjsify/domparser';

const parser = new DOMParser();
const doc = parser.parseFromString('<map width="20" height="15"><layer name="bg"/></map>', 'text/xml');

const map = doc.querySelector('map');
console.log(map?.getAttribute('width')); // "20"

const layers = doc.querySelectorAll('layer');
console.log(layers[0]?.getAttribute('name')); // "bg"
```

## License

MIT

# @gjsify/adwaita-icons

The Adwaita symbolic icon set as importable SVG strings for browser builds. Covers all icon categories (actions, devices, mimetypes, places, status, ui) sourced from the GNOME Adwaita icon theme, with a `toDataUri()` helper for use in CSS `mask-image` and `background-image` properties.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/adwaita-icons

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/adwaita-icons
yarn add @gjsify/adwaita-icons
```

## Usage

```typescript
import { toDataUri } from '@gjsify/adwaita-icons/utils';

// Import icons from a specific category
import { folder_symbolic } from '@gjsify/adwaita-icons/places';
import { document_new_symbolic } from '@gjsify/adwaita-icons/actions';

// Use as a CSS data URI (for mask-image / background-image)
const css = `mask-image: ${toDataUri(folder_symbolic)};`;

// Or import all categories at once
import * as icons from '@gjsify/adwaita-icons';
```

## License

LGPL-3.0-or-later AND CC-BY-SA-3.0

# @gjsify/adwaita-fonts

Adwaita Sans TTF font files plus `@font-face` CSS (fontsource-style) for browser builds. Carries the GNOME/Libadwaita typographic identity to the web, sourced from the upstream Adwaita fonts project.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/adwaita-fonts

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/adwaita-fonts
yarn add @gjsify/adwaita-fonts
```

## Usage

```css
/* Import the full @font-face declaration (weight 400, normal) */
@import '@gjsify/adwaita-fonts';

/* Or import a specific weight variant directly */
@import '@gjsify/adwaita-fonts/400.css';
@import '@gjsify/adwaita-fonts/400-italic.css';
```

```typescript
// When used with a bundler that handles CSS imports
import '@gjsify/adwaita-fonts';

// Then use the font family in CSS
// font-family: 'Adwaita Sans', sans-serif;
```

## License

OFL-1.1

# @gjsify/dom-events

GJS implementation of Web DOM Events including Event, CustomEvent, EventTarget, UIEvent, MouseEvent, PointerEvent, KeyboardEvent, WheelEvent, FocusEvent, and DOMException.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/dom-events
# or
yarn add @gjsify/dom-events
```

## Usage

```typescript
import { Event, CustomEvent, EventTarget } from '@gjsify/dom-events';

const target = new EventTarget();
target.addEventListener('custom', (e) => {
  console.log(e.detail);
});
target.dispatchEvent(new CustomEvent('custom', { detail: 'hello' }));
```

## Inspirations and credits

- https://deno.land/manual@v1.29.2/runtime/web_platform_apis#customevent-eventtarget-and-eventlistener
- https://github.com/jsdom/jsdom/tree/master/lib/jsdom/living/events
- https://github.com/capricorn86/happy-dom/tree/master/packages/happy-dom/src/event

## License

MIT

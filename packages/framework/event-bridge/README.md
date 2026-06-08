# @gjsify/event-bridge

GTK to DOM event bridge for GJS. Maps GTK4 event controllers to standard DOM events (MouseEvent, PointerEvent, KeyboardEvent, WheelEvent, FocusEvent).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/event-bridge

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/event-bridge
yarn add @gjsify/event-bridge
```

## Usage

```typescript
import { attachEventControllers } from '@gjsify/event-bridge';

// Attach GTK4 event controllers that dispatch DOM events
attachEventControllers(gtkWidget, () => domElement);
```

### Supported Event Mappings

| GTK Controller | DOM Events |
|---|---|
| EventControllerMotion | pointermove, mousemove, pointer/mouse enter/leave/over/out |
| GestureClick | pointer/mouse down/up, click, dblclick, contextmenu |
| EventControllerScroll | wheel |
| EventControllerKey | keydown, keyup |
| EventControllerFocus | focus, focusin, blur, focusout |

## License

MIT

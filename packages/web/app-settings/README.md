# @gjsify/app-settings

A `Gio.Settings` subset that runs on the browser and NativeScript (Android), with the same names and semantics as real GJS. See ADR 0099.

| Platform | Backend |
|---|---|
| GJS | real `Gio.Settings` (`src/index.ts`) |
| Browser | `localStorage` (`src/browser.ts`) |
| NativeScript (`src/nativescript.ts`) | `ApplicationSettings` (`@nativescript/core`, optional peer) |

## API

```ts
import { Settings } from '@gjsify/app-settings';

const settings = new Settings({ schema_id: 'org.example.App', path: '/org/example/App/' });
settings.set_int('window-width', 800);
settings.get_int('window-width');
settings.connect('changed::window-width', (_s, key) => {});
```

Supported: `get/set_{boolean,int,uint,double,string}`, `get_value`/`set_value` with `GLib.Variant`, `connect('changed[::key]')`, `disconnect`, `schema_id`, `path`.
Key types: `b i u d s` and the arrays `ab ai au ad as` (ADR 0118). An array key is read and written through `get_value`/`set_value` and stored as its GVariant text (`print(false)`). Everything else (`list_keys`, `get_strv`, `reset`, `apply`, `delay`, `Gio.Settings.new`) is refused by name, and `bind()` throws.

## Schema

The schema is a `.gschema.xml`. Import it with the `?schema` specifier; the build step turns it into a module that calls `Settings.register`. On GJS, `register` is a no-op and the compiled schema is used.

Unsupported schema features (range, choices, enum, flags, child, override) are refused at build time.

A stored value that cannot be parsed counts as unset and is logged once.

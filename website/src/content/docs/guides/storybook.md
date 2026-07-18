---
title: Storybook
description: Build a live component browser for your GTK/Adwaita widgets with GJSify — write a *.story.ts, run `gjsify storybook`, and get a sidebar of interactive, control-driven previews
---

GJSify ships a **storybook**: a live component browser for your widgets, the GTK/Adwaita analogue of [Storybook](https://storybook.js.org/). Write a `*.story.ts` per widget, run `gjsify storybook`, and get a categorized sidebar of interactive previews whose properties are driven by a live controls panel — no per-project storybook *app* to maintain.

It is the idiomatic way to **develop, document, and visually verify** custom widgets. Pair it with [devtools](./devtools/) to drive/screenshot the running storybook headlessly.

## The pieces

| Package | Role |
|---|---|
| [`@gjsify/stories`](https://www.npmjs.com/package/@gjsify/stories) | The renderer-agnostic contract (pure TS): `StoryMeta`, `ControlType`, `StoryControl`, `StoryModule`. One story definition, any renderer. |
| [`@gjsify/storybook`](https://www.npmjs.com/package/@gjsify/storybook) | The **GTK/Adwaita** renderer: `StoryWidget` base + the component-browser window. |
| [`@gjsify/storybook-core`](https://www.npmjs.com/package/@gjsify/storybook-core) | Renderer-agnostic logic (registry, control binding, the app controller) the renderers share. |
| [`@gjsify/adwaita-storybook`](https://www.npmjs.com/package/@gjsify/adwaita-storybook) · [`@gjsify/storybook-nativescript`](https://www.npmjs.com/package/@gjsify/storybook-nativescript) | The browser + NativeScript renderers — the same stories, other targets. |

Driven by one CLI command: [`gjsify storybook`](../../cli-reference/#gjsify-storybook).

## 1. Write a story

A story is a `StoryWidget` subclass with a static `getMetadata(): StoryMeta`. The metadata's `title` (`"Category/Name"`) groups the sidebar; its `controls` become a live two-way-bound panel. Build the preview in `initialize()`, react to control changes in `updateArgs()`, and export the class in a `StoryModule`.

Here is the real story for [`@gjsify/adwaita-app`](./native-adwaita-app/)'s `LoadingStack` widget — a SELECT control switches its loading / content / error pages:

```ts
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { LoadingStack } from '@gjsify/adwaita-app';

export class LoadingStackStory extends StoryWidget {
    private _stack: LoadingStack | null = null;

    static { GObject.registerClass({ GTypeName: 'AdwaitaAppLoadingStackStory' }, LoadingStackStory); }

    constructor() {
        super(StoryWidget.fromMeta(LoadingStackStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'Adwaita App/LoadingStack',
            description: 'A Gtk.Stack pre-wired with loading / content / error pages.',
            component: LoadingStack.$gtype,
            controls: [
                {
                    name: 'state',
                    label: 'State',
                    type: ControlType.SELECT,
                    options: [
                        { label: 'Loading', value: 'loading' },
                        { label: 'Content', value: 'content' },
                        { label: 'Error', value: 'error' },
                    ],
                    defaultValue: 'loading',
                },
                { name: 'errorTitle', label: 'Error title', type: ControlType.TEXT, defaultValue: 'Something went wrong' },
            ],
        };
    }

    initialize(): void {
        this._stack = new LoadingStack({ widthRequest: 360, heightRequest: 220 });
        this._stack.setContent(new Gtk.Label({ label: 'Loaded content 🎉', cssClasses: ['title-2'] }));
        this.addContent(this._stack);
        this.updateArgs(this.args);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._stack) return;
        this._stack.setError(this.args.errorTitle as string);
        this._stack.set_visible_child_name(this.args.state as string);
    }
}

GObject.type_ensure(LoadingStackStory.$gtype);

export const LoadingStackStories: StoryModule = { stories: [LoadingStackStory] };
```

Control kinds (`ControlType`): `TEXT`, `NUMBER`, `RANGE`, `BOOLEAN`, `SELECT` (with `options`), `COLOR`. Each control's `name` is the key in `this.args`; its `defaultValue` is spelled once and seeds the initial args.

## 2. Configure + run

Add `@gjsify/storybook` as a dev dependency, point `package.json#gjsify.storybook` at your stories directory, and add a script:

```jsonc
{
  "scripts": { "storybook": "gjsify storybook" },
  "devDependencies": { "@gjsify/storybook": "^0.18.0" },
  "gjsify": {
    "storybook": {
      "applicationId": "org.example.Storybook",
      "title": "My Widgets",
      "stories": "stories",   // dir scanned for *.story.ts
      "globals": "auto"        // "auto,dom" for canvas/DOM stories
    }
  }
}
```

```bash
gjsify storybook                       # discover *.story.ts, build --app gjs, launch the browser
gjsify storybook --watch               # rebuild + reload on change
gjsify storybook --build-only --out dist/storybook.gjs.mjs   # build without launching (CI-friendly)
gjsify storybook --runtime node        # build + run the SAME storybook on Node via the @gjsify/node-gi bridge
```

`--runtime node` (or `"runtime": "node"` in the config block) builds the identical storybook with `--app node` and runs it on Node.js through the [node-gi reverse bridge](/gjsify/projects/node-gi/) — useful where GJS isn't available (CI, containers, editor tooling). It requires `@gjsify/node-gi` as a project `devDependency`.

## The rule of thumb

Treat a story as part of the widget: **every new custom widget ships a `*.story.ts` alongside it.** It is the widget's living documentation and its visual regression surface (screenshot it via [devtools](./devtools/) in CI). A widget without a story is undocumented.

## See also

- [`gjsify storybook`](../../cli-reference/#gjsify-storybook) — CLI reference.
- [Adwaita Storybook showcase](../../showcases/adwaita-storybook/) — the full Libadwaita widget set as stories.
- [Native Adwaita Apps](./native-adwaita-app/) — where the `LoadingStack` example lives.
- [Devtools & MCP](./devtools/) — drive/screenshot the running storybook headlessly.

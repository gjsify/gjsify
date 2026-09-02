---
title: Storybook
description: Build a live component browser for your GTK/Adwaita widgets. Write a *.story.ts next to each widget, run `gjsify storybook`, and get a sidebar of interactive previews with live controls.
---

Write one `*.story.ts` per widget, run `gjsify storybook`, and you get a component browser:
a categorised sidebar of your widgets, each rendered live, with a controls panel that edits
its properties while it runs. It is the GTK/Adwaita counterpart to
[Storybook](https://storybook.js.org/), and there is no per-project storybook app to build
or maintain.

## Add it to a project

```bash
gjsify install --save-dev @gjsify/storybook
```

Then point the CLI at your stories in `package.json` and add a script:

```jsonc
{
  "scripts": {
    "storybook": "gjsify storybook"
  },
  "gjsify": {
    "storybook": {
      "applicationId": "org.example.Storybook",
      "title": "My Widgets",
      "stories": "stories",   // directory scanned recursively; defaults to "src"
      "globals": "auto"       // use "auto,dom" for canvas or DOM stories
    }
  }
}
```

Every key is optional. Without `stories` the CLI scans `src`; without `applicationId` it
derives one from your package name.

## Write a story

A story is a `StoryWidget` subclass with a static `getMetadata()`. The metadata's `title`
takes the form `"Category/Name"` and drives the sidebar grouping; its `controls` become the
live panel. Build the preview in `initialize()`, react to control changes in `updateArgs()`,
and export the class in a `StoryModule`.

Here is the story that ships with
[`@gjsify/adwaita-app`](/gjsify/guides/native-adwaita-app/) for its `LoadingStack` widget, where a
dropdown switches between the loading, content and error pages:

```ts
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
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
        this._stack.setContent(new Gtk.Label({ label: 'Loaded content', cssClasses: ['title-2'] }));
        this.addContent(this._stack);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._stack) return;
        this._stack.setError(this.args.errorTitle as string);
        this._stack.set_visible_child_name(this.args.state as string);
    }
}

GObject.type_ensure(LoadingStackStory.$gtype);

export const LoadingStackStories: StoryModule = { stories: [LoadingStackStory] };
```

`StoryWidget` gives you three hooks to override and one helper to call:

| Member | What it is for |
|---|---|
| `initialize()` | Build the preview. Runs when the story is first opened. |
| `updateArgs(args)` | React to a control change. Read values from `this.args`. |
| `teardown()` | Release resources and disconnect signals when the story is deselected. |
| `addContent(widget)` | Put a widget into the default preview slot. |

`this.args` is a plain object keyed by each control's `name`. `setArg(name, value)` changes
one value from code, which also runs `updateArgs`.

## Pick a control

| `ControlType` | Renders as | Extra fields |
|---|---|---|
| `TEXT` | Text entry | `defaultValue: string` |
| `NUMBER` | Spinner | `min`, `max`, `step`, `defaultValue: number` |
| `RANGE` | Slider | `min`, `max`, `step`, `defaultValue: number` |
| `BOOLEAN` | Switch | `defaultValue: boolean` |
| `SELECT` | Dropdown | `options: { label, value }[]`, `defaultValue` |
| `COLOR` | Colour picker | `defaultValue: '#rrggbb'` |

Every control also takes an optional `description`, shown as help text. A control's
`defaultValue` is spelled once and seeds the story's initial args, so you don't repeat it in
`initialize()`.

## Run it

```bash
gjsify storybook                    # find *.story.ts, build, launch the browser
gjsify storybook --watch            # rebuild and relaunch when a story changes
gjsify storybook --stories widgets  # scan a different directory
```

The bundle lands in `node_modules/.cache/gjsify-storybook` unless you pass `--out`. For CI,
build without launching, and name the target you are building for:

```bash
gjsify storybook --build-only --out dist/storybook.gjs.mjs
gjsify storybook --build-only --runtime node --out dist/storybook.node.mjs
```

## Pick the runtime

Left alone, `gjsify storybook` builds and launches on whichever runtime the CLI itself is
running on. `--runtime` says which one you want, and you can set the same value as
`"runtime"` in the config block:

```bash
gjsify storybook --runtime gjs
gjsify storybook --runtime node
gjsify storybook --runtime bun
gjsify storybook --runtime deno
```

What actually differs is one layer:

- **gjs** builds an `--app gjs` bundle. `gi://Gtk` and `gi://Adw` resolve in the host
  itself, so nothing sits between a story and GTK. Needs a `gjs` binary, which exists on
  Linux and not on Windows.
- **node, bun and deno** build one shared `--app node` bundle (Node-API is their common
  ABI) and resolve `gi://` through [`@gjsify/node-gi`](/gjsify/projects/node-gi/), which
  the project needs as a `devDependency`. This is the route that reaches macOS and Windows,
  and the one CI drives the full Adwaita gallery through: the same prebuilt bundle renders
  the gallery under Node on Linux (system GTK, Xvfb) and on Windows (the bundled GTK
  runtime, no gvsbuild).

Same stories, same sidebar, same controls panel either way.

## Screenshot a story from CI or an agent

Start the storybook with the devtools gate on and bridge it with the storybook profile:

```bash
GJSIFY_DEVTOOLS=1 gjsify storybook
gjsify debug --profile storybook
```

That gives you `list_stories`, `open_story`, `get_current_story` and `set_story_arg`
alongside the generic `screenshot`, so you can walk every story, flip its args, and capture
each variant. See [Devtools & MCP](/gjsify/guides/devtools/) for the whole loop.

## The rule of thumb

Treat a story as part of the widget: **every custom widget ships a `*.story.ts` next to
it.** It is the widget's living documentation and its visual regression surface. A widget
without a story is a widget nobody can look at without running your whole app.

## The packages behind it

| Package | Role |
|---|---|
| [`@gjsify/stories`](https://www.npmjs.com/package/@gjsify/stories) | The renderer-agnostic authoring contract: `StoryMeta`, `ControlType`, `StoryControl`, `StoryModule`. Re-exported by the renderers, so a story needs one import. |
| [`@gjsify/storybook`](https://www.npmjs.com/package/@gjsify/storybook) | The GTK/Adwaita renderer: `StoryWidget` plus the component-browser window. |
| [`@gjsify/storybook-core`](https://www.npmjs.com/package/@gjsify/storybook-core) | Shared registry, control binding and app controller. |
| [`@gjsify/adwaita-storybook`](https://www.npmjs.com/package/@gjsify/adwaita-storybook) · [`@gjsify/storybook-nativescript`](https://www.npmjs.com/package/@gjsify/storybook-nativescript) | The browser and NativeScript renderers. Same stories, other targets. |

## See also

- [`gjsify storybook`](../../cli-reference/#gjsify-storybook) for every flag.
- [Adwaita Storybook showcase](../../showcases/adwaita-storybook/), the full Libadwaita
  widget set as stories.
- [Native Adwaita Apps](/gjsify/guides/native-adwaita-app/), where the `LoadingStack` above comes from.
- [Devtools & MCP](/gjsify/guides/devtools/) for driving and screenshotting the running storybook.

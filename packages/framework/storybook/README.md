# @gjsify/storybook

A reusable **GTK/Adwaita storybook** for GJS. Author component previews as `*.story.ts` files anywhere in your project, then browse them in a generic Adwaita component explorer — a sidebar grouped by category, a live preview pane, and an auto-generated controls panel with two-way binding. No per-project storybook *application* to maintain.

It is the GTK renderer for the runtime-agnostic [`@gjsify/stories`](../stories) contract (re-exported here, so a story needs only one import).

## Author a story

```ts
import GObject from 'gi://GObject?version=2.0';
import { ControlType, StoryWidget, type StoryArgs, type StoryMeta, type StoryModule } from '@gjsify/storybook';
import { MyButton } from './my-button.js';

export class MyButtonStory extends StoryWidget {
    private _button: MyButton | null = null;
    static {
        GObject.registerClass({ GTypeName: 'MyButtonStory' }, MyButtonStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(MyButtonStory.getMetadata(), 'Default')); // defaults derived from controls
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'UI/My Button', // "UI" groups the sidebar
            component: MyButton.$gtype,
            controls: [
                { name: 'label', label: 'Label', type: ControlType.TEXT, defaultValue: 'Click me' },
                { name: 'size', label: 'Size', type: ControlType.RANGE, min: 16, max: 96, step: 2, defaultValue: 42 },
            ],
        };
    }

    initialize(): void {
        this._button = new MyButton({ label: this.args.label as string });
        this.addContent(this._button);
    }

    updateArgs(_args: StoryArgs): void {
        if (this._button && typeof this.args.label === 'string') this._button.label = this.args.label;
    }
}

GObject.type_ensure(MyButtonStory.$gtype);

export const MyButtonStories: StoryModule = { stories: [MyButtonStory] };
```

Subclasses that supply their own composite `.blp` template have full layout control; otherwise `addContent()` drops the preview into default chrome. The optional `withActionGroup(prefix, actions)` decorator (`StoryModule.decorators`) installs a stubbed `Gio.SimpleActionGroup` so a previewed widget's buttons resolve in the sandbox.

## Run it

The easy way — let the CLI discover and launch every `*.story.ts`:

```bash
gjsify storybook
```

Configure it in `package.json`:

```jsonc
"gjsify": {
  "storybook": {
    "applicationId": "org.example.Storybook",
    "title": "Example Storybook",
    "stories": "src/**/*.story.ts",
    "globals": "auto,dom"   // add ,dom when stories use canvas/DOM widgets
  }
}
```

Or wire a launcher yourself with `runStorybook` + `collectStoryModules`:

```ts
import { collectStoryModules, runStorybook } from '@gjsify/storybook';
import * as button from './widgets/my-button.story.js';

await runStorybook({
    applicationId: 'org.example.Storybook',
    stories: collectStoryModules([button]),
});
```

## Debug it over MCP

Run the storybook with `GJSIFY_DEVTOOLS=1` and it exposes the [`@gjsify/devtools`](../devtools) control plane, so an AI agent can drive it:

```bash
GJSIFY_DEVTOOLS=1 gjsify storybook        # exposes org.gjsify.Devtools
gjsify debug --profile storybook          # MCP bridge: list_stories / get_current_story / open_story / set_story_arg (+ generic screenshot)
```

See the [Debugging & remote control guide](https://gjsify.github.io/gjsify/guides/devtools/).

## Exports

- `StoryWidget` — Adw.Bin base class; `fromMeta()`, `addContent()`, `initialize()`/`updateArgs()`/`teardown()` hooks
- `StoryModule` / `StoryWidgetConstructor` — registration shape (with optional module `decorators`)
- `StoryRegistryService` — collects modules and instantiates their widgets
- `StorybookApplication` / `StorybookWindow` — the Adwaita host + component browser
- `runStorybook(options)` / `collectStoryModules(namespaces)` — launcher + discovery
- `withActionGroup` / `installActionGroup` / `StoryAction` — action-group decorator helpers
- re-exported contract: `ControlType`, `StoryControl` (+ per-kind types), `StoryMeta`, `StoryArgs`, `argsFromControls`

## Build / test

```bash
gjsify workspace @gjsify/storybook build
gjsify workspace @gjsify/storybook test
```

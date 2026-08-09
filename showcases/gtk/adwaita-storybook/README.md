# Adwaita Storybook

An interactive **component browser for [Libadwaita](https://gnome.pages.gitlab.gnome.org/libadwaita/)**
widgets — the GNOME equivalent of a web "storybook". Each widget is rendered live, in
isolation, with a two-way-bound **Controls** panel so you can poke at its properties and
watch it update.

It is a showcase for three pieces of gjsify tooling working together:

- **[`@gjsify/storybook`](../../../packages/framework/storybook)** — the GTK/Adwaita story
  renderer (sidebar by category, live control panel).
- **[`@gjsify/stories`](../../../packages/framework/stories)** — the pure-TS story contract.
- **[`@gjsify/devtools`](../../../packages/framework/devtools)** — a DBus + MCP control plane
  that lets an agent (or you, with `gdbus`) drive and screenshot every story headlessly.

![Avatar story](docs/avatar.png)

## Run it

```bash
# from this directory
gjsify storybook            # discover every *.story.ts, build (--app gjs), launch the browser
gjsify storybook --watch    # rebuild + relaunch on change
```

`gjsify storybook` reads the `gjsify.storybook` block in [`package.json`](package.json)
(application id, window title, the `src` story dir, and `--globals auto`). No per-project
storybook *app* — just `*.story.ts` files plus the shared renderer.

### On Node, Bun and Deno

The same window and the same stories on the other three runtimes, with GTK reached through
[`@gjsify/node-gi`](../../../packages/node-gi/node-gi) instead of GJS:

```bash
gjsify storybook --runtime node                  # or --runtime bun / --runtime deno
gjsify showcase adwaita-storybook --runtime bun  # without a checkout
```

ONE bundle serves all three (`dist/gjs.node.mjs`), because Node-API is their common native
ABI — there is no per-runtime build, and `build:node` produces it once. `--runtime gjs`
builds the separate `--app gjs` bundle.

This is not a fourth story format. The stories are renderer-free and this is the same native
GTK renderer reached over a different bridge; what a runtime has to prove is that the bridge
holds. All three open the window and claim `org.gjsify.AdwaitaStorybook` on the session bus,
which is exactly what the DBus harness below drives — so "it works there" is a checkable
claim, not a build that merely completed.

## Debug / drive it over DBus + MCP

Launch with the devtools control plane enabled, then drive it from `gdbus`, an MCP client,
or the bundled harness:

```bash
GJSIFY_DEVTOOLS=1 gjsify storybook          # exports org.gjsify.Devtools on the session bus
# in another shell — list + open stories, read/set args:
gdbus call --session --dest org.gjsify.AdwaitaStorybook \
  --object-path /org/gjsify/AdwaitaStorybook/devtools \
  --method org.gjsify.Devtools.ListStories
```

Over MCP (the storybook profile adds `list_stories` / `open_story` / `get_current_story` /
`set_story_arg` on top of the generic `screenshot` / `swap_css` / … tools):

```bash
gjsify debug --profile storybook            # MCP bridge to a running storybook
```

### Screenshot every story

[`tools/shoot-stories.js`](tools/shoot-stories.js) opens each story over the devtools DBus
surface and saves a GSK-rendered PNG of the window — the same path used to review this
showcase:

```bash
GJSIFY_DEVTOOLS=1 gjsify storybook &                       # launch
gjs -m tools/shoot-stories.js org.gjsify.AdwaitaStorybook ./shots   # capture all stories
```

## Stories

Stories live under [`src/`](src), grouped into category folders. The sidebar group comes
from the `"Category/Name"` story `title`, not the folder.

| Category | Widgets |
|---|---|
| Presentation | Avatar, Banner, StatusPage, Spinner, WindowTitle |
| Boxed Lists | ActionRow, EntryRow, PasswordEntryRow, ComboRow, SpinRow, SwitchRow, ExpanderRow, ButtonRow, PreferencesGroup |
| Buttons | SplitButton, ButtonContent, ToggleGroup, button style classes |
| Layout | Clamp, WrapBox, ToolbarView, HeaderBar |
| Navigation | NavigationView, NavigationSplitView, OverlaySplitView, BottomSheet, Sidebar |
| View Switching | ViewSwitcher + ViewStack, InlineViewSwitcher, Carousel, TabView |
| Feedback | Toast, AlertDialog, AboutDialog, PreferencesDialog |

## Add a story

A story is a `StoryWidget` subclass with a `static getMetadata(): StoryMeta` (the
`"Category/Name"` title groups the sidebar, the `controls` drive the live panel),
exported as a `StoryModule`. See [`src/presentation/avatar.story.ts`](src/presentation/avatar.story.ts)
for the canonical pattern:

```ts
import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

export class MyStory extends StoryWidget {
    private _widget: Adw.Avatar | null = null;
    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookMyStory' }, MyStory);
    }
    constructor() {
        super(StoryWidget.fromMeta(MyStory.getMetadata(), 'Default'));
    }
    static getMetadata(): StoryMeta {
        return {
            title: 'Presentation/My Widget',
            controls: [{ name: 'text', label: 'Text', type: ControlType.TEXT, defaultValue: 'Hi' }],
        };
    }
    initialize(): void {
        this._widget = new Adw.Avatar({ text: this.args.text as string, size: 96 });
        this.addContent(this._widget);
    }
    updateArgs(_args: StoryArgs): void {
        if (this._widget) this._widget.text = this.args.text as string;
    }
}
GObject.type_ensure(MyStory.$gtype);
export const MyStories: StoryModule = { stories: [MyStory] };
```

Rules of thumb: globally-unique `GTypeName` (prefix `AdwStorybook…`), wrap `Adw.*Row`s in an
`Adw.PreferencesGroup`, give space-filling widgets a `widthRequest`/`heightRequest`, and
present dialogs from a button rather than embedding them.

## License

MIT © Pascal Garber. Libadwaita is LGPL-2.1+ © GNOME contributors.

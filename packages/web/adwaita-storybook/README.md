# @gjsify/adwaita-storybook

Browser renderer for the [`@gjsify/stories`](../../framework/stories) contract — the web counterpart of [`@gjsify/storybook`](../../framework/storybook). It renders stories as a generic Adwaita component browser built from [`@gjsify/adwaita-web`](../adwaita-web) custom elements, so a web storybook looks and behaves like the native GTK one and the two targets can be compared 1:1 (e.g. via screenshots).

## Usage

Author stories as `StoryElement` subclasses (the DOM analog of `@gjsify/storybook`'s `StoryWidget`):

```ts
import { ControlType, StoryElement, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';

export class ButtonStylesWebStory extends StoryElement {
    constructor() {
        super(ButtonStylesWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'Buttons/Button Styles',
            description: 'adw-button with Adwaita style variants.',
            controls: [
                { name: 'label', label: 'Label', type: ControlType.TEXT, defaultValue: 'Click me' },
            ],
        };
    }

    initialize(): void {
        const button = document.createElement('adw-button');
        button.setAttribute('label', this.args.label as string);
        this.addContent(button);
    }

    updateArgs(): void {
        // react to control changes
    }
}

export const ButtonStylesWebStories: WebStoryModule = { stories: [ButtonStylesWebStory] };
```

Mount the app:

```ts
import { mountStorybook } from '@gjsify/adwaita-storybook';
import { ButtonStylesWebStories } from './button-styles.web.js';

mountStorybook(document.body, {
    title: 'Adwaita Storybook',
    stories: [ButtonStylesWebStories],
});
```

`mountStorybook` builds the full chrome — a sidebar of stories grouped by category, a preview pane, and a controls panel that renders the story's `controls` as live-bound adwaita-web rows.

The package entry is TypeScript (`src/index.ts`), consumed via a TypeScript-compiling build — `gjsify build --app browser` / the `gjsifyBrowser()` Vite preset (or any Vite/bundler setup), same as `@gjsify/adwaita-web`. Type declarations are shipped pre-built at `lib/types/index.d.ts`, so `gjsify tsc` consumers resolve the package's types without compiling its source.

## Driving it programmatically

`mountStorybook` exposes a small control surface on `window.__storybook` (`listStories`, `openStory`, `getCurrentStory`, `setArg`, `getArgs`), so a host browser's MCP `eval_js` (see [`@gjsify/devtools-browser`](../../framework/devtools-browser)) can drive and screenshot stories without an in-page devtools channel.

## Sharing metadata with the native renderer

A story's `StoryMeta` (its `controls`, defaults, title, description) is renderer-agnostic. Author it once in a `*.meta.ts` module and import it from both the GTK `*.story.ts` and the web `*.web.ts`, so the two renderers are guaranteed to expose identical controls.

// StoryElement — base class for browser story implementations. The web
// counterpart of @gjsify/storybook's StoryWidget (which extends Adw.Bin): it
// builds DOM with @gjsify/adwaita-web components instead of GTK widgets, but
// exposes the same authoring surface (getMetadata, initialize, updateArgs,
// teardown, addContent, meta/story/args) so a story is a near-1:1 port of its
// GTK twin and the two render identically.

import { argsFromControls, type StoryArgs, type StoryArgValue, type StoryMeta } from '@gjsify/stories';

/** Notified whenever a story's args change (the controls panel re-syncs through this). */
export type StoryArgsListener = (args: StoryArgs) => void;

/**
 * Base class for browser story elements.
 *
 * Provides default chrome — a clamped boxed group with a title + description
 * above a centered, dashed-framed preview stage — built programmatically. Simple
 * stories compose their preview by calling {@link addContent}; a subclass that
 * needs a bespoke layout passes its own root element to the constructor (then
 * {@link addContent} is a no-op).
 */
export class StoryElement {
    private _meta: StoryMeta;
    private _story: string;
    private _args: StoryArgs;
    private _listeners = new Set<StoryArgsListener>();

    /** The root node inserted into the storybook's preview area. */
    readonly element: HTMLElement;

    private _stage: HTMLElement | null = null;
    private _titleEl: HTMLElement | null = null;
    private _descEl: HTMLElement | null = null;

    /**
     * @param meta       The story's metadata (the same renderer-agnostic object
     *                   its GTK twin uses).
     * @param story      Variant name (defaults to "Default").
     * @param customRoot Opt out of the default chrome by supplying a root element.
     */
    constructor(meta: StoryMeta, story = 'Default', customRoot?: HTMLElement) {
        this._meta = meta;
        this._story = story;
        this._args = argsFromControls(meta.controls);
        this.element = customRoot ?? this._installDefaultChrome();
    }

    get meta(): StoryMeta {
        return this._meta;
    }

    get story(): string {
        return this._story;
    }

    get args(): StoryArgs {
        return this._args;
    }

    set args(value: StoryArgs) {
        if (this._args === value) return;
        this._args = value;
        this.updateArgs(value);
        for (const listener of this._listeners) listener(value);
    }

    /** Subscribe to args changes; returns an unsubscribe function. */
    onArgsChanged(listener: StoryArgsListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /** Set a single arg — drives {@link updateArgs} and notifies listeners. */
    setArg(name: string, value: StoryArgValue): void {
        this.args = { ...this._args, [name]: value };
    }

    /** Override in subclasses — build the preview. Runs in the registry init path. */
    initialize(): void {}

    /** Override in subclasses — react to a control change. */
    updateArgs(_args: StoryArgs): void {}

    /** Override in subclasses to release resources on deselect. */
    teardown(): void {}

    /** Replace the default preview slot's content. No-op with a custom root. */
    addContent(node: HTMLElement): void {
        if (!this._stage) return;
        this._stage.replaceChildren(node);
    }

    private _installDefaultChrome(): HTMLElement {
        const page = document.createElement('div');
        page.className = 'sb-story-page';

        const clamp = document.createElement('div');
        clamp.className = 'sb-story-clamp';

        const group = document.createElement('div');
        group.className = 'sb-story-group';

        const header = document.createElement('div');
        header.className = 'sb-story-group-header';
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'sb-story-group-title';
        this._descEl = document.createElement('span');
        this._descEl.className = 'sb-story-group-description';
        header.append(this._titleEl, this._descEl);

        // Subtle dashed frame so the preview's bounds stay locatable even when
        // the widget is transparent or in an empty state (mirrors the native
        // .story-stage in @gjsify/storybook).
        this._stage = document.createElement('div');
        this._stage.className = 'story-stage';

        group.append(header, this._stage);
        clamp.append(group);
        page.append(clamp);

        this._refreshChromeText();
        return page;
    }

    private _refreshChromeText(): void {
        if (!this._titleEl || !this._descEl) return;
        const title = this._story ? `${this._meta.title} — ${this._story}` : this._meta.title;
        const description = this._meta.description ?? '';
        this._titleEl.textContent = title;
        this._descEl.textContent = description;
        this._descEl.hidden = description.length === 0;
    }
}

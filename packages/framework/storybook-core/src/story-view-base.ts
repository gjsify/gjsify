// StoryViewBase — renderer-agnostic base for a single story's view.
//
// Original implementation, extracted from the three renderer story bases:
//   - @gjsify/storybook            StoryWidget   (GTK, extends Adw.Bin)
//   - @gjsify/adwaita-storybook    StoryElement  (browser, DOM)
//   - @gjsify/storybook-nativescript  StoryView  (NativeScript, extends StackLayout)
//
// All three carried the identical authoring surface — `meta`/`story`/`args`
// getters, an `args` setter that fires `updateArgs` + notifies listeners,
// `onArgsChanged`/`setArg`, overridable `initialize`/`updateArgs`/`teardown`,
// `addContent`, and a `_refreshChromeText` that formats `"<title> — <story>"`.
// This base owns that surface; each renderer supplies only the platform-specific
// chrome via {@link StoryViewBase.createChrome}.

import { argsFromControls, type StoryArgs, type StoryArgValue, type StoryMeta } from '@gjsify/stories';

/**
 * The renderer-built chrome around a story's preview "stage". The default chrome
 * is a clamp → boxed group → header(title, description) → `.story-stage`; a
 * subclass passing a custom root opts out (then {@link hasStage} is false and
 * {@link addContent} is a no-op).
 *
 * @typeParam TNode the renderer's view-node type (`Gtk.Widget`, `HTMLElement`,
 *                  NativeScript `View`).
 */
export interface StoryChrome<TNode> {
    /** The root node inserted into the storybook's preview area. */
    readonly root: TNode;
    /** Replace the preview stage's content (no-op for a custom root). */
    setStageContent(child: TNode): void;
    /** Whether a default stage exists (false for a custom root). */
    readonly hasStage: boolean;
    /** Update the header's title + description text. */
    setChromeText(title: string, description: string): void;
}

/**
 * Base class for a single story's view, parameterised by the renderer's node
 * type. A renderer's story base (`StoryWidget` / `StoryElement` / `StoryView`)
 * extends this, implements {@link createChrome}, and calls {@link initBase} from
 * its own constructor (a base constructor cannot call an abstract method before
 * the subclass's field initialisers have run, so init is explicit).
 *
 * @typeParam TNode the renderer's view-node type.
 */
export abstract class StoryViewBase<TNode> {
    protected _meta!: StoryMeta;
    protected _story!: string;
    protected _args!: StoryArgs;

    private _listeners = new Set<(args: StoryArgs) => void>();
    private _chrome!: StoryChrome<TNode>;

    /**
     * Build the renderer's chrome. Called once from {@link initBase}. With
     * `customRoot` set, return a chrome whose `root` is that node and whose
     * `hasStage` is false (the default-chrome path otherwise).
     */
    protected abstract createChrome(meta: StoryMeta, customRoot?: TNode): StoryChrome<TNode>;

    /**
     * Initialise the base state + chrome. Call from the subclass constructor
     * (NOT the base constructor — an abstract `createChrome` must not run before
     * the subclass's own fields are initialised).
     */
    protected initBase(meta: StoryMeta, story: string, customRoot?: TNode): void {
        this._meta = meta;
        this._story = story;
        this._args = argsFromControls(meta.controls);
        this._chrome = this.createChrome(meta, customRoot);
        this.refreshChromeText();
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

    /** The root node the storybook inserts into its preview area. */
    get root(): TNode {
        return this._chrome.root;
    }

    set args(value: StoryArgs) {
        if (this._args === value) return;
        this._args = value;
        this.updateArgs(value);
        this.emitArgs(value);
    }

    /**
     * Notify args listeners. Overridable so a renderer can ALSO fire its own
     * change signal (e.g. the GTK adapter's GObject `notify('args')`) in the
     * same path.
     */
    protected emitArgs(value: StoryArgs): void {
        for (const listener of this._listeners) listener(value);
    }

    /** Subscribe to args changes; returns an unsubscribe function. */
    onArgsChanged(listener: (args: StoryArgs) => void): () => void {
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
    addContent(child: TNode): void {
        if (this._chrome.hasStage) this._chrome.setStageContent(child);
    }

    /** Recompute + push the `"<title> — <story>"` header text into the chrome. */
    protected refreshChromeText(): void {
        const title = this._story ? `${this._meta.title} — ${this._story}` : this._meta.title;
        this._chrome.setChromeText(title, this._meta.description ?? '');
    }
}

// StoryElement — base class for browser story implementations. The web
// counterpart of @gjsify/storybook's StoryWidget (which extends Adw.Bin): it
// builds DOM with @gjsify/adwaita-web components instead of GTK widgets, but
// exposes the same authoring surface (getMetadata, initialize, updateArgs,
// teardown, addContent, meta/story/args) so a story is a near-1:1 port of its
// GTK twin and the two render identically.
//
// Thin DOM adapter over @gjsify/storybook-core's StoryViewBase: the
// renderer-agnostic state (meta/story/args, onArgsChanged/setArg, the
// initialize/updateArgs/teardown/addContent surface) lives in the base; this
// class supplies ONLY the @gjsify/adwaita-web DOM chrome via createChrome().

import type { StoryArgs, StoryMeta } from '@gjsify/stories';
import { type StoryChrome, StoryViewBase } from '@gjsify/storybook-core';

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
export class StoryElement extends StoryViewBase<HTMLElement> {
    /**
     * @param meta       The story's metadata (the same renderer-agnostic object
     *                   its GTK twin uses).
     * @param story      Variant name (defaults to "Default").
     * @param customRoot Opt out of the default chrome by supplying a root element.
     */
    constructor(meta: StoryMeta, story = 'Default', customRoot?: HTMLElement) {
        super();
        this.initBase(meta, story, customRoot);
    }

    /**
     * The root node inserted into the storybook's preview area. Alias for the
     * base's {@link root} getter — kept because consumers reference `.element`.
     */
    get element(): HTMLElement {
        return this.root;
    }

    /** Build the @gjsify/adwaita-web DOM chrome — the single renderer seam. */
    protected createChrome(_meta: StoryMeta, customRoot?: HTMLElement): StoryChrome<HTMLElement> {
        if (customRoot) {
            return {
                root: customRoot,
                hasStage: false,
                setStageContent: () => {},
                setChromeText: () => {},
            };
        }
        return this._installDefaultChrome();
    }

    private _installDefaultChrome(): StoryChrome<HTMLElement> {
        const page = document.createElement('div');
        page.className = 'sb-story-page';

        const clamp = document.createElement('div');
        clamp.className = 'sb-story-clamp';

        const group = document.createElement('div');
        group.className = 'sb-story-group';

        const header = document.createElement('div');
        header.className = 'sb-story-group-header';
        const titleEl = document.createElement('span');
        titleEl.className = 'sb-story-group-title';
        const descEl = document.createElement('span');
        descEl.className = 'sb-story-group-description';
        header.append(titleEl, descEl);

        // Subtle dashed frame so the preview's bounds stay locatable even when
        // the widget is transparent or in an empty state (mirrors the native
        // .story-stage in @gjsify/storybook).
        const stage = document.createElement('div');
        stage.className = 'story-stage';

        group.append(header, stage);
        clamp.append(group);
        page.append(clamp);

        return {
            root: page,
            hasStage: true,
            setStageContent: (child) => stage.replaceChildren(child),
            setChromeText: (title, description) => {
                titleEl.textContent = title;
                descEl.textContent = description;
                descEl.hidden = description.length === 0;
            },
        };
    }
}

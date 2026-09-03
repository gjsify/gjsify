// StoryView — base class for NativeScript story implementations. The NS twin of
// @gjsify/storybook's StoryWidget (GTK, extends Adw.Bin) and
// @gjsify/adwaita-storybook's StoryElement (browser, DOM): it builds REAL native
// NativeScript views with @gjsify/adwaita-nativescript components instead of
// DOM/GTK widgets, but exposes the SAME authoring surface (meta/story/args,
// initialize, updateArgs, teardown, addContent, onArgsChanged, setArg) so a
// `*.ns.ts` story is a near-1:1 port of its `*.web.ts` / `*.story.ts` twin. That
// the three targets then RENDER the same is an intention, not a measurement — no
// screenshot harness exists (#1052); the parity that is actually held is
// behavioural, through the @gjsify/adwaita-core/conformance vectors.
//
// Thin NativeScript adapter over @gjsify/storybook-core's StoryViewBase: the
// renderer-agnostic state (meta/story/args, onArgsChanged/setArg, the
// initialize/updateArgs/teardown/addContent surface) lives in the base; this
// class supplies ONLY the @gjsify/adwaita-nativescript native chrome via
// createChrome().

import type { StoryArgs, StoryMeta } from '@gjsify/stories';
import { type StoryChrome, StoryViewBase } from '@gjsify/storybook-core';
import { Adw } from '@gjsify/adwaita-nativescript';
import { Label, StackLayout, type View } from '@nativescript/core';

/** Notified whenever a story's args change (the controls panel re-syncs through this). */
export type StoryArgsListener = (args: StoryArgs) => void;

/**
 * Base class for NativeScript story views.
 *
 * Provides default chrome — a clamped boxed group (`Adw.Clamp` +
 * `AdwPreferencesGroup`) with a title + description above a centered, tinted
 * preview "stage" — built programmatically with the
 * `@gjsify/adwaita-nativescript` widgets + the Adwaita CSS classes. Simple
 * stories compose their preview by calling {@link addContent}; a subclass that
 * needs a bespoke layout passes its own root view to the constructor (then
 * {@link addContent} is a no-op), mirroring the browser `customRoot` opt-out.
 */
export class StoryView extends StoryViewBase<View> {
    /**
     * @param meta       The story's metadata (the same renderer-agnostic object
     *                   its GTK / browser twins use).
     * @param story      Variant name (defaults to "Default").
     * @param customRoot Opt out of the default chrome by supplying a root view.
     */
    constructor(meta: StoryMeta, story = 'Default', customRoot?: View) {
        super();
        this.initBase(meta, story, customRoot);
    }

    /**
     * The real NativeScript `View` an NS `Page`/`Frame` mounts. Alias for the
     * base's {@link root} getter — the NS counterpart of the browser's
     * `.element` (and of the GTK base simply being a widget). NativeScript needs
     * a concrete `View` to add to a page, so this surfaces one.
     */
    get view(): View {
        return this.root;
    }

    /** Build the @gjsify/adwaita-nativescript native chrome — the single renderer seam. */
    protected createChrome(_meta: StoryMeta, customRoot?: View): StoryChrome<View> {
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

    private _installDefaultChrome(): StoryChrome<View> {
        const page = new StackLayout();
        page.orientation = 'vertical';
        page.className = 'sb-story-page';

        const clamp = new Adw.Clamp();
        clamp.className = `${clamp.className} sb-story-clamp`.trim();

        // A plain transparent container (NOT an AdwPreferencesGroup): the GTK +
        // browser chrome render the title/description as BARE text on the window
        // background with the preview below — only the story's OWN widgets carry a
        // boxed-list card. Wrapping the chrome in a preferences-group card put the
        // title/description inside a heavy white box, unlike native. Mirrors the
        // browser StoryElement (`div.sb-story-group` styled transparent by CSS).
        const group = new StackLayout();
        group.orientation = 'vertical';
        group.className = 'sb-story-group';

        // Header (title + description) — a vertical Label stack above the stage.
        const header = new StackLayout();
        header.orientation = 'vertical';
        header.className = 'sb-story-group-header';

        const titleLabel = new Label();
        titleLabel.className = 'sb-story-group-title';
        titleLabel.textWrap = true;
        header.addChild(titleLabel);

        const descLabel = new Label();
        descLabel.className = 'sb-story-group-description';
        descLabel.textWrap = true;
        let hasDesc = false;

        // Tinted stage so the preview's bounds stay locatable even when the
        // widget is transparent or empty (mirrors the browser `.story-stage`
        // and the native renderer's `.story-stage`).
        const stage = new StackLayout();
        stage.orientation = 'vertical';
        stage.className = 'story-stage';
        stage.horizontalAlignment = 'center';

        group.addChild(header);
        group.addChild(stage);
        clamp.setChild(group);
        page.addChild(clamp);

        return {
            root: page,
            hasStage: true,
            setStageContent: (child) => {
                stage.removeChildren();
                stage.addChild(child);
            },
            setChromeText: (title, description) => {
                titleLabel.text = title;
                descLabel.text = description;
                const wantDesc = description.length > 0;
                if (wantDesc && !hasDesc) {
                    header.addChild(descLabel);
                    hasDesc = true;
                } else if (!wantDesc && hasDesc) {
                    header.removeChild(descLabel);
                    hasDesc = false;
                }
            },
        };
    }
}

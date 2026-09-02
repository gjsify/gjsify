// StoryWidget — GTK/Adwaita adapter for the renderer-agnostic StoryViewBase.
//
// The lifecycle/state logic (meta/story/args, onArgsChanged, setArg,
// initialize/updateArgs/teardown, addContent, chrome-text formatting) lives in
// @gjsify/storybook-core's StoryViewBase. GObject forces a delegation wrapper:
// StoryWidget MUST stay an `Adw.Bin` subclass with a registered `args` GObject
// property (the window subscribes via `connect('notify::args')`), and a GObject
// class cannot also extend the plain-TS base. So StoryWidget owns a private
// `_core` (a small StoryViewBase<Gtk.Widget> subclass) and forwards to it; the
// core's `emitArgs` override calls back to fire `this.notify('args')`, keeping
// the live-refresh signal intact.

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { argsFromControls, type StoryArgs, type StoryArgValue, type StoryMeta } from '@gjsify/stories';
import { type StoryChrome, StoryViewBase } from '@gjsify/storybook-core';

export namespace StoryWidget {
    export interface ConstructorProps {
        meta: StoryMeta;
        story: string;
        args: StoryArgs;
    }
}

/**
 * The GTK chrome around a story preview — a centered `Adw.PreferencesPage` /
 * `Adw.PreferencesGroup` with title + description above a `.story-stage` content
 * box. Returned by {@link StoryCore.createChrome} as a {@link StoryChrome}.
 */
function buildGtkChrome(bin: Adw.Bin): StoryChrome<Gtk.Widget> {
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup();
    const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        margin_top: 12,
        margin_bottom: 12,
        spacing: 12,
        hexpand: true,
    });
    // Tinted stage so the preview's bounds are visible even when the widget
    // itself is transparent or in an empty state (see `.story-stage`).
    content.add_css_class('story-stage');

    group.add(content);
    page.add(group);
    bin.set_child(page);

    return {
        root: bin,
        hasStage: true,
        setStageContent(child: Gtk.Widget): void {
            let existing = content.get_first_child();
            while (existing) {
                existing.unparent();
                existing = content.get_first_child();
            }
            content.append(child);
        },
        setChromeText(title: string, description: string): void {
            // BOTH of these labels are `use-markup="True"`
            // (adw-preferences-group.ui:20-23, :33-35), and a `StoryMeta`'s title
            // and description are renderer-agnostic PLAIN TEXT — the browser
            // target assigns them as `textContent`, the NativeScript one as
            // `Label.text`. So one unescaped `&`, `<` or `>` in a meta makes Pango
            // reject the whole string and the chrome renders EMPTY, with only a
            // `Gtk-WARNING` on stderr to say so. Found by the first meta to
            // describe an accelerator grammar: "pressed together (&)".
            group.set_title(GLib.markup_escape_text(title, -1));
            group.set_description(GLib.markup_escape_text(description, -1));
        },
    };
}

/**
 * Inner core state object. A subclass of the renderer-agnostic
 * {@link StoryViewBase} whose chrome is the GTK Adwaita layout and whose
 * `emitArgs` override ALSO fires the outer widget's GObject `notify('args')`.
 * The `Adw.Bin` it renders into is the outer {@link StoryWidget} itself.
 */
class StoryCore extends StoryViewBase<Gtk.Widget> {
    constructor(
        private readonly _widget: StoryWidget,
        meta: StoryMeta,
        story: string,
    ) {
        super();
        this.initBase(meta, story);
    }

    protected createChrome(_meta: StoryMeta): StoryChrome<Gtk.Widget> {
        return buildGtkChrome(this._widget);
    }

    // Run the outer widget's overrides (a subclass overrides StoryWidget's
    // initialize/updateArgs/teardown, not the core's).
    override initialize(): void {
        this._widget.initialize();
    }

    override updateArgs(args: StoryArgs): void {
        this._widget.updateArgs(args);
    }

    override teardown(): void {
        this._widget.teardown();
    }

    // ALSO fire the GObject notify so `connect('notify::args')` keeps working.
    protected override emitArgs(value: StoryArgs): void {
        super.emitArgs(value);
        this._widget.notify('args');
    }
}

/**
 * Base class for GJS story widgets — a thin GTK adapter over
 * {@link StoryViewBase}.
 *
 * Provides default chrome — a centered `Adw.PreferencesPage` /
 * `Adw.PreferencesGroup` with title + description above a content slot — built
 * programmatically (no `Template`). Simple stories compose their preview by
 * calling {@link addContent}; elaborate subclasses can override the layout by
 * providing their own composite template (then {@link addContent} is a no-op).
 */
export class StoryWidget extends Adw.Bin {
    private _core!: StoryCore;

    static {
        GObject.registerClass(
            {
                GTypeName: 'StoryWidget',
                Properties: {
                    meta: GObject.ParamSpec.object(
                        'meta',
                        'Meta',
                        'Story metadata',
                        GObject.ParamFlags.READWRITE,
                        GObject.Object,
                    ),
                    story: GObject.ParamSpec.string(
                        'story',
                        'Story Name',
                        'Story name',
                        GObject.ParamFlags.READWRITE,
                        '',
                    ),
                    args: GObject.ParamSpec.object(
                        'args',
                        'Args',
                        'Story arguments',
                        GObject.ParamFlags.READWRITE,
                        GObject.Object,
                    ),
                },
            },
            StoryWidget,
        );
    }

    constructor(params: StoryWidget.ConstructorProps, adwParams: Partial<Adw.Bin.ConstructorProps> = {}) {
        super(adwParams);

        // Building the core installs the GTK chrome into this Bin (set_child).
        this._core = new StoryCore(this, params.meta, params.story);
    }

    /**
     * Build the constructor params from a story's metadata, deriving the initial
     * args from the controls' default values (so defaults are spelled once).
     */
    static fromMeta(meta: StoryMeta, story: string): StoryWidget.ConstructorProps {
        return { meta, story, args: argsFromControls(meta.controls) };
    }

    get meta(): StoryMeta {
        return this._core.meta;
    }

    get story(): string {
        return this._core.story;
    }

    get args(): StoryArgs {
        return this._core.args;
    }

    set args(value: StoryArgs) {
        // Drives core's updateArgs + emitArgs (the latter fires notify('args')).
        this._core.args = value;
    }

    /** Subscribe to args changes; returns an unsubscribe function. */
    onArgsChanged(listener: (args: StoryArgs) => void): () => void {
        return this._core.onArgsChanged(listener);
    }

    /** Set a single arg — drives {@link updateArgs} and notifies listeners. */
    setArg(name: string, value: StoryArgValue): void {
        this._core.setArg(name, value);
    }

    /** Override in subclasses — build the preview. Runs in the registry init path. */
    initialize(): void {}

    /** Override in subclasses — react to a control change. */
    updateArgs(_args: StoryArgs): void {}

    /** Override in subclasses to release resources / disconnect signals on deselect. */
    teardown(): void {}

    /**
     * Add a widget to the default story preview slot. No-op if the subclass
     * installed its own composite template.
     */
    addContent(widget: Gtk.Widget): void {
        this._core.addContent(widget);
    }
}

GObject.type_ensure(StoryWidget.$gtype);

/** Wraps a story's content-build step (e.g. to install a shared action group). */
export type StoryDecorator = (build: () => void, widget: StoryWidget) => void;

/** Constructor contract for a story class: zero-arg `new`, static metadata. */
export interface StoryWidgetConstructor {
    new (): StoryWidget;
    $gtype: GObject.GType;
    getMetadata(): StoryMeta;
}

/** A group of related stories, optionally wrapped by module-level decorators. */
export interface StoryModule {
    stories: StoryWidgetConstructor[];
    /** Populated by {@link StoryRegistryService.createStoryInstances}. */
    instances?: StoryWidget[];
    /** Decorators applied around every story's `initialize()` in this module. */
    decorators?: StoryDecorator[];
}

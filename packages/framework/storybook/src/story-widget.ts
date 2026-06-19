// StoryWidget — base class for GTK story implementations.
// original implementation using Adwaita/GTK + the @gjsify/stories contract.

import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import { argsFromControls, type StoryArgs, type StoryMeta } from '@gjsify/stories';

export namespace StoryWidget {
    export interface ConstructorProps {
        meta: StoryMeta;
        story: string;
        args: StoryArgs;
    }
}

/**
 * Base class for GJS story widgets.
 *
 * Provides default chrome — a centered `Adw.PreferencesPage` /
 * `Adw.PreferencesGroup` with title + description above a content slot — built
 * programmatically (no `Template`). Simple stories compose their preview by
 * calling {@link addContent}; elaborate subclasses can override the layout by
 * providing their own composite template (then {@link addContent} is a no-op).
 */
export class StoryWidget extends Adw.Bin {
    private _meta!: StoryMeta;
    private _story = '';
    private _args!: StoryArgs;

    private _storyContent: Gtk.Box | null = null;
    private _group: Adw.PreferencesGroup | null = null;

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

        this._meta = params.meta;
        this._story = params.story;
        this._args = params.args;

        if (this.get_child() == null) {
            this._installDefaultChrome();
        }
    }

    /**
     * Build the constructor params from a story's metadata, deriving the initial
     * args from the controls' default values (so defaults are spelled once).
     */
    static fromMeta(meta: StoryMeta, story: string): StoryWidget.ConstructorProps {
        return { meta, story, args: argsFromControls(meta.controls) };
    }

    get meta(): StoryMeta {
        return this._meta;
    }

    set meta(value: StoryMeta) {
        if (this._meta === value) return;
        this._meta = value;
        this.notify('meta');
        this._refreshChromeText();
    }

    get story(): string {
        return this._story;
    }

    set story(value: string) {
        if (this._story === value) return;
        this._story = value;
        this.notify('story');
        this._refreshChromeText();
    }

    get args(): StoryArgs {
        return this._args;
    }

    set args(value: StoryArgs) {
        if (this._args === value) return;
        this._args = value;
        this.notify('args');
        this.updateArgs(value);
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
        if (!this._storyContent) return;

        let child = this._storyContent.get_first_child();
        while (child) {
            child.unparent();
            child = this._storyContent.get_first_child();
        }
        this._storyContent.append(widget);
    }

    private _installDefaultChrome(): void {
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

        group.add(content);
        page.add(group);
        this.set_child(page);

        this._group = group;
        this._storyContent = content;
        this._refreshChromeText();
    }

    private _refreshChromeText(): void {
        if (!this._group) return;
        const title = this._meta
            ? this._story
                ? `${this._meta.title} — ${this._story}`
                : this._meta.title
            : this._story;
        const description = this._meta?.description ?? '';
        this._group.set_title(title);
        this._group.set_description(description);
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

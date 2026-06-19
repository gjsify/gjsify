// StorybookApplication — the parameterized Adw.Application that hosts the
// storybook window. original implementation.

import Adw from '@girs/adw-1';
import Gdk from '@girs/gdk-4.0';
import Gio from '@girs/gio-2.0';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import { StoryRegistryService } from './registry.js';
import type { StoryModule } from './story-widget.js';
import { STORYBOOK_CSS } from './styles.js';
import { StorybookWindow } from './window.js';

/** Options that adapt the generic storybook to a host project. */
export interface StorybookOptions {
    /** GApplication id, e.g. `org.example.Storybook`. */
    applicationId: string;
    /** Window title (defaults to the `.blp` template's "Storybook"). */
    title?: string;
    /** Story modules to display. */
    stories: StoryModule[];
    /** Consumer's own widget stylesheet, layered on top of the built-in chrome CSS. */
    css?: string;
}

/**
 * Hosts the storybook: loads styles on startup, builds the window and populates
 * it from a fresh {@link StoryRegistryService} on activate. One registry per
 * application instance (no shared singleton).
 */
export class StorybookApplication extends Adw.Application {
    private _window: StorybookWindow | null = null;
    private _registry = new StoryRegistryService();
    private _options: StorybookOptions;

    static {
        GObject.registerClass({ GTypeName: 'StorybookApplication' }, StorybookApplication);
    }

    constructor(options: StorybookOptions) {
        super({
            application_id: options.applicationId,
            flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
        });
        this._options = options;
        this.connect('startup', () => this._initStyles());
        this.connect('activate', () => this._onActivate());
    }

    private _initStyles(): void {
        const provider = new Gtk.CssProvider();
        provider.load_from_string(`${STORYBOOK_CSS}\n${this._options.css ?? ''}`);
        const display = Gdk.Display.get_default();
        if (!display) {
            console.error('No display found');
            return;
        }
        Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    }

    private _onActivate(): void {
        if (!this._window) {
            this._window = new StorybookWindow({ application: this });
            if (this._options.title) {
                this._window.set_title(this._options.title);
            }
            this._registry.registerStories(this._options.stories);
            try {
                const modules = this._registry.createStoryInstances();
                this._window.populateSidebar(modules);
            } catch (error) {
                console.error('Failed to create story instances:', error);
            }
        }
        this._window.present();
    }
}

GObject.type_ensure(StorybookApplication.$gtype);

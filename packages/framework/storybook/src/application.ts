// StorybookApplication — the parameterized Adw.Application that hosts the
// storybook window. original implementation.

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { installDevtools } from '@gjsify/devtools';
import { storybookDevtoolsExtension } from './devtools-extension.js';
import { installStorybookProbe, probeEnabled, type StorybookProbeOptions } from './probe.js';
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
    /** Force-enable the devtools control plane (otherwise gated on `GJSIFY_DEVTOOLS`). */
    devtools?: boolean;
    /** Self-verification probe options (only used when `GJSIFY_STORYBOOK_PROBE` is set). */
    probe?: StorybookProbeOptions;
}

/**
 * Hosts the storybook: loads styles on startup, builds the window and populates
 * it from a fresh {@link StoryRegistryService} on activate. One registry per
 * application instance (no shared singleton).
 */
export class StorybookApplication extends Adw.Application {
    private _window: StorybookWindow | null = null;
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
            try {
                // The window's controller registers + instantiates the modules,
                // renders the sidebar, and opens the first story.
                this._window.populateSidebar(this._options.stories);
            } catch (error) {
                console.error('Failed to create story instances:', error);
            }
            // Opt-in devtools control plane: a no-op unless GJSIFY_DEVTOOLS is set
            // (or `devtools: true`), so production runs are unaffected.
            installDevtools(this, {
                enabled: this._options.devtools || undefined,
                extend: [storybookDevtoolsExtension(this._window)],
            });
            // Opt-in self-verification: when GJSIFY_STORYBOOK_PROBE is set, drive
            // the storybook headlessly (categories + chrome + a story render +
            // GSK screenshot) and quit with a PASS/FAIL exit — a no-op otherwise.
            if (probeEnabled()) {
                installStorybookProbe(this, this._window, this._options.probe);
            }
        }
        this._window.present();
    }
}

GObject.type_ensure(StorybookApplication.$gtype);

// StorybookWindow — the generic component browser: a sidebar of stories grouped
// by category, a preview pane, and a controls panel that renders live-bound
// Adwaita rows from each story's controls.
//
// The window is the GTK adapter: it keeps ALL the GTK chrome construction
// (NavigationSplitView + OverlaySplitView + Adw.Breakpoint + the Gtk.ListBox
// sidebar + the controls PreferencesGroup) and the Adwaita control widgets, and
// implements the renderer-agnostic StorybookView<StoryWidget> seams. A
// StorybookController<StoryWidget> from @gjsify/storybook-core owns the state
// machine (registration, instantiation, category grouping, selection, the
// controls refresh cycle, and the MCP/devtools surface).
//
// The window tree is built programmatically rather than from a .blp template so
// the package is self-contained — a published library cannot rely on the
// blueprint build plugin (which only runs for `--app` bundles, not `--library`).

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import type { StoryArgValue, StoryNumberControl, StorySelectControl } from '@gjsify/stories';
import {
    bindControl,
    type CategoryGroup,
    type ControlRow,
    type ControlWidget,
    type ControlWidgetFactory,
    StorybookController,
    type StorybookView,
} from '@gjsify/storybook-core';
import { buildAppearanceDialog, StorybookAppearance } from './appearance.js';
import type { StoryModule, StoryWidget } from './story-widget.js';
import type { StoryRow } from './types.js';

/**
 * Builds the Adwaita leaf control widgets — the single renderer-specific seam
 * `bindControl` consumes. Each returns a {@link ControlWidget} exposing the
 * row's view node, a get/set for its decoded value, and an onChange hook.
 */
function adwControlWidgetFactory(): ControlWidgetFactory<Gtk.Widget> {
    return {
        text(label, desc) {
            const row = new Adw.EntryRow({ title: label });
            if (desc) row.set_tooltip_text(desc);
            let onChange: ((v: string) => void) | null = null;
            row.connect('changed', () => onChange?.(row.get_text()));
            return {
                node: row,
                get: () => row.get_text(),
                set: (value) => row.set_text(value),
                onChange: (cb) => {
                    onChange = cb;
                },
            };
        },

        boolean(label, desc) {
            const row = new Adw.SwitchRow({ title: label, subtitle: desc ?? '' });
            let onChange: ((v: boolean) => void) | null = null;
            row.connect('notify::active', () => onChange?.(row.get_active()));
            return {
                node: row,
                get: () => row.get_active(),
                set: (value) => row.set_active(value),
                onChange: (cb) => {
                    onChange = cb;
                },
            };
        },

        number(control) {
            const row = Adw.SpinRow.new_with_range(control.min ?? 0, control.max ?? 100, control.step ?? 1);
            row.set_title(control.label || control.name);
            if (control.description) row.set_subtitle(control.description);
            let onChange: ((v: number) => void) | null = null;
            row.connect('changed', () => onChange?.(row.get_value()));
            return {
                node: row,
                get: () => row.get_value(),
                set: (value) => row.set_value(value),
                onChange: (cb) => {
                    onChange = cb;
                },
            };
        },

        range(control) {
            return buildRangeWidget(control);
        },

        select(control) {
            return buildSelectWidget(control);
        },

        color(label, desc) {
            return buildColorWidget(label, desc);
        },
    };
}

/**
 * The RANGE control: a vertical card so the label + description don't get
 * squashed into a single-letter column when the controls sidebar is narrow. The
 * widget's value is the scale's numeric value.
 */
function buildRangeWidget(config: StoryNumberControl): ControlWidget<Gtk.Widget, number> {
    const min = config.min ?? 0;
    const max = config.max ?? 100;
    const step = config.step ?? 1;
    const initial = typeof config.min === 'number' ? config.min : 0;
    const shouldRound = Number.isInteger(step) && Number.isInteger(initial);

    const adjustment = new Gtk.Adjustment({
        lower: min,
        upper: max,
        step_increment: step,
        value: initial,
    });
    adjustment.step_increment = step;

    const row = new Gtk.ListBoxRow({ selectable: false, activatable: false });
    row.add_css_class('story-range-row');

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
    });

    const header = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12 });
    const titleLabel = new Gtk.Label({
        label: config.label || config.name,
        halign: Gtk.Align.START,
        hexpand: true,
        ellipsize: 3, // PANGO_ELLIPSIZE_END
    });
    titleLabel.add_css_class('heading');

    const formatValue = (value: number): string => (shouldRound ? String(Math.round(value)) : value.toFixed(2));

    const valueLabel = new Gtk.Label({
        label: formatValue(initial),
        halign: Gtk.Align.END,
    });
    valueLabel.add_css_class('numeric');
    valueLabel.add_css_class('dim-label');

    header.append(titleLabel);
    header.append(valueLabel);
    box.append(header);

    if (config.description) {
        const desc = new Gtk.Label({
            label: config.description,
            halign: Gtk.Align.START,
            xalign: 0,
            wrap: true,
            max_width_chars: 32,
        });
        desc.add_css_class('caption');
        desc.add_css_class('dim-label');
        box.append(desc);
    }

    const scale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment,
        draw_value: false,
        hexpand: true,
    });

    let onChange: ((v: number) => void) | null = null;
    let suppress = false;
    scale.connect('value-changed', () => {
        if (suppress) return;
        let value = scale.get_value();
        if (shouldRound) {
            const rounded = Math.round(value);
            if (rounded !== value) {
                scale.set_value(rounded);
                return;
            }
            value = rounded;
        }
        valueLabel.set_label(formatValue(value));
        onChange?.(value);
    });

    box.append(scale);
    row.set_child(box);

    return {
        node: row,
        get: () => scale.get_value(),
        set: (value) => {
            suppress = true;
            scale.set_value(value);
            suppress = false;
            valueLabel.set_label(formatValue(value));
        },
        onChange: (cb) => {
            onChange = cb;
        },
    };
}

/** The SELECT control: an Adw.ComboRow. Index-valued (the selected option's index). */
function buildSelectWidget(config: StorySelectControl): ControlWidget<Gtk.Widget, number> {
    const options = config.options ?? [];
    const model = Gtk.StringList.new(options.map((opt) => opt.label));
    const row = new Adw.ComboRow({
        title: config.label || config.name,
        subtitle: config.description ?? '',
        model,
    });

    let onChange: ((v: number) => void) | null = null;
    row.connect('notify::selected', () => onChange?.(row.get_selected()));

    return {
        node: row,
        get: () => row.get_selected(),
        set: (value) => row.set_selected(value),
        onChange: (cb) => {
            onChange = cb;
        },
    };
}

/** The COLOR control: an Adw.ActionRow with a Gtk.ColorDialogButton; value is hex `#rrggbb`. */
function buildColorWidget(label: string, desc: string | undefined): ControlWidget<Gtk.Widget, string> {
    const row = new Adw.ActionRow({ title: label, subtitle: desc ?? '' });
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({ title: label }),
        valign: Gtk.Align.CENTER,
    });
    row.add_suffix(button);
    row.set_activatable_widget(button);

    const channel = (v: number): string =>
        Math.round(Math.max(0, Math.min(1, v)) * 255)
            .toString(16)
            .padStart(2, '0');
    const rgbaToHex = (rgba: Gdk.RGBA): string => `#${channel(rgba.red)}${channel(rgba.green)}${channel(rgba.blue)}`;

    let onChange: ((v: string) => void) | null = null;
    let suppress = false;
    button.connect('notify::rgba', () => {
        if (suppress) return;
        onChange?.(rgbaToHex(button.get_rgba()));
    });

    return {
        node: row,
        get: () => rgbaToHex(button.get_rgba()),
        set: (value) => {
            const rgba = new Gdk.RGBA();
            if (rgba.parse(value)) {
                suppress = true;
                button.set_rgba(rgba);
                suppress = false;
            }
        },
        onChange: (cb) => {
            onChange = cb;
        },
    };
}

/**
 * Main window for the storybook. The sidebar lists story instances grouped by
 * the `Category/Name` title prefix; the preview pane holds the active
 * {@link StoryWidget} and an `Adw.PreferencesGroup` of controls drives its
 * `args` with two-way binding. Implements {@link StorybookView} so the shared
 * {@link StorybookController} drives it.
 */
export class StorybookWindow extends Adw.ApplicationWindow implements StorybookView<StoryWidget> {
    private _sidebar_list!: Gtk.ListBox;
    private _content_area!: Adw.Bin;
    private _control_panel!: Adw.PreferencesGroup;
    private _preview_title!: Adw.WindowTitle;
    private _show_controls_button!: Gtk.ToggleButton;
    /** Colour scheme + accent for the whole storybook, not for one story. */
    private _appearance = new StorybookAppearance();
    private _controls_split_view!: Adw.OverlaySplitView;
    private _main_split_view!: Adw.NavigationSplitView;

    private _controlRows: Gtk.Widget[] = [];
    private _rowByTitle = new Map<string, StoryRow>();
    private _controller: StorybookController<StoryWidget>;
    private _onSelect: ((instance: StoryWidget) => void) | null = null;
    // Guards the markSelected → select_row → row-selected feedback loop.
    private _suppressSelect = false;

    static {
        GObject.registerClass({ GTypeName: 'StorybookWindow' }, StorybookWindow);
    }

    constructor(params: Partial<Adw.ApplicationWindow.ConstructorProps>) {
        super(params);

        this.set_default_size(1200, 800);
        this.set_size_request(360, 320);
        this.set_title('Storybook');

        this._buildUI();

        // The controller owns the app state machine; this window is its view.
        // `buildControls` maps each story's controls through bindControl with the
        // Adwaita widget factory.
        this._controller = new StorybookController<StoryWidget>(this, (instance) => this._buildControls(instance));

        this._sidebar_list.connect('row-selected', this._onRowSelected.bind(this));
        this._show_controls_button.connect('toggled', this._onToggleControls.bind(this));
        this._controls_split_view.set_show_sidebar(true);
    }

    private _onRowSelected(_listbox: Gtk.ListBox, row: Gtk.ListBoxRow | null): void {
        if (this._suppressSelect || !row) return;
        const storyRow = row as StoryRow;
        if (storyRow.storyWidget) this._onSelect?.(storyRow.storyWidget);
    }

    /** The controller driving this window (exposed for the devtools extension). */
    get controller(): StorybookController<StoryWidget> {
        return this._controller;
    }

    private _buildControls(instance: StoryWidget): Array<ControlRow<unknown>> {
        const controls = instance.meta.controls;
        if (!Array.isArray(controls)) return [];
        const factory = adwControlWidgetFactory();
        const rows: Array<ControlRow<unknown>> = [];
        for (const control of controls) {
            if (!control?.name || !control?.type) {
                console.warn('Invalid control configuration:', control);
                continue;
            }
            const row = bindControl<Gtk.Widget>(instance, control, factory);
            if (row) rows.push(row as ControlRow<unknown>);
        }
        return rows;
    }

    private _buildUI(): void {
        // --- Sidebar (story list) ---
        this._sidebar_list = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.SINGLE });
        this._sidebar_list.add_css_class('navigation-sidebar');
        const sidebarScroll = new Gtk.ScrolledWindow({ hexpand: true, vexpand: true, child: this._sidebar_list });
        const sidebarHeader = new Adw.HeaderBar({
            title_widget: new Adw.WindowTitle({ title: 'Stories' }),
            show_end_title_buttons: false,
        });
        // Flat top bar so the sidebar header shares the sidebar background
        // (the left column reads as one distinct shade).
        const sidebarToolbar = new Adw.ToolbarView({
            content: sidebarScroll,
            top_bar_style: Adw.ToolbarStyle.FLAT,
        });
        sidebarToolbar.add_top_bar(sidebarHeader);
        const sidebarPage = new Adw.NavigationPage({ title: 'Stories', tag: 'stories', child: sidebarToolbar });

        // --- Preview content + controls overlay ---
        this._content_area = new Adw.Bin({ hexpand: true, vexpand: true });
        const contentScroll = new Gtk.ScrolledWindow({ hexpand: true, vexpand: true, child: this._content_area });
        // The preview AREA owns the tinted surface (see `.sb-preview-area`). On the
        // scroller rather than on the Bin inside it, so the tint spans the pane and
        // stays put while a tall story scrolls.
        contentScroll.add_css_class('sb-preview-area');

        this._control_panel = new Adw.PreferencesGroup({ title: 'Controls' });
        const prefsPage = new Adw.PreferencesPage();
        prefsPage.add(this._control_panel);
        const controlsScroll = new Gtk.ScrolledWindow({ vexpand: true, child: prefsPage });

        this._controls_split_view = new Adw.OverlaySplitView({
            show_sidebar: true,
            sidebar_position: Gtk.PackType.END,
            min_sidebar_width: 280,
            max_sidebar_width: 360,
            content: contentScroll,
            sidebar: controlsScroll,
            // Controls panel shares the window (story) background — only the
            // left navigation sidebar keeps a distinct shade (see STORYBOOK_CSS).
            css_classes: ['storybook-controls'],
        });

        // --- Preview header ---
        this._preview_title = new Adw.WindowTitle({ title: 'Preview' });
        this._show_controls_button = new Gtk.ToggleButton({
            icon_name: 'sidebar-show-right-symbolic',
            tooltip_text: 'Toggle Controls',
            active: true,
        });
        const previewHeader = new Adw.HeaderBar({ title_widget: this._preview_title });
        previewHeader.pack_end(this._show_controls_button);
        // Appearance is a property of the storybook, so it belongs in its chrome
        // rather than in a story's controls — every story is previewed under it.
        const appearanceButton = new Gtk.Button({
            icon_name: 'applications-graphics-symbolic',
            tooltip_text: 'Appearance',
        });
        // Built fresh per press rather than held: an Adw.Dialog is presented and
        // closed, and a reused instance that was closed with the window manager
        // refuses to present again.
        appearanceButton.connect('clicked', () => buildAppearanceDialog(this._appearance).present(this));
        previewHeader.pack_end(appearanceButton);
        // Flat top bar so the preview header shares the window (story)
        // background instead of a distinct headerbar shade.
        const previewToolbar = new Adw.ToolbarView({
            content: this._controls_split_view,
            top_bar_style: Adw.ToolbarStyle.FLAT,
        });
        previewToolbar.add_top_bar(previewHeader);
        const previewPage = new Adw.NavigationPage({ title: 'Preview', tag: 'preview', child: previewToolbar });

        // --- Outer split view ---
        this._main_split_view = new Adw.NavigationSplitView({
            min_sidebar_width: 220,
            max_sidebar_width: 320,
            sidebar: sidebarPage,
            content: previewPage,
        });
        this.set_content(this._main_split_view);

        // Collapse both panes on narrow widths (the .blp `Adw.Breakpoint`,
        // expressed via apply/unapply so no GObject.Value boxing is needed).
        const condition = Adw.BreakpointCondition.parse('max-width: 720sp');
        if (condition) {
            const breakpoint = new Adw.Breakpoint({ condition });
            breakpoint.connect('apply', () => {
                this._main_split_view.collapsed = true;
                this._controls_split_view.collapsed = true;
            });
            breakpoint.connect('unapply', () => {
                this._main_split_view.collapsed = false;
                this._controls_split_view.collapsed = false;
            });
            this.add_breakpoint(breakpoint);
        }
    }

    private _onToggleControls(button: Gtk.ToggleButton): void {
        this._controls_split_view.set_show_sidebar(button.get_active());
    }

    /**
     * Populate the sidebar with story modules. Registers + instantiates them via
     * the controller (which renders the sidebar through this view's
     * {@link renderSidebar} seam) and opens the first story.
     */
    populateSidebar(storyModules: StoryModule[]): void {
        this._controller.mount(storyModules, true);
    }

    // --- StorybookView<StoryWidget> seams (driven by the controller) ---

    renderSidebar(groups: Array<CategoryGroup<StoryWidget>>, onSelect: (instance: StoryWidget) => void): void {
        this._onSelect = onSelect;
        this._suppressSelect = true;
        this._clearSidebar();
        this._rowByTitle.clear();

        for (const group of groups) {
            this._addCategoryToSidebar(group.category);
            for (const { instance, name } of group.stories) {
                this._addStoryToSidebar(instance, name);
            }
        }
        this._suppressSelect = false;
    }

    markSelected(title: string): void {
        const row = this._rowByTitle.get(title);
        if (row && this._sidebar_list.get_selected_row() !== row) {
            // Programmatic selection — don't re-enter the controller via row-selected.
            this._suppressSelect = true;
            this._sidebar_list.select_row(row);
            this._suppressSelect = false;
        }
    }

    setPreviewTitle(title: string): void {
        this._preview_title.set_title(title);
    }

    showPreview(instance: StoryWidget): void {
        this._content_area.set_child(instance);
        if (this._main_split_view.get_collapsed()) {
            this._main_split_view.set_show_content(true);
        }
    }

    renderControls(rows: Array<ControlRow<unknown>>): void {
        this._clearControlPanel();
        for (const row of rows) {
            const widget = row.view as Gtk.Widget;
            // A control's `label` and `description` are plain text from the
            // `StoryMeta`, but every `AdwPreferencesRow` renders its title and
            // subtitle with `use-markup` TRUE by default
            // (adw-preferences-row.c:186) — so one `&`, `<` or `>` makes Pango
            // reject the string and the row renders with an EMPTY subtitle.
            // Cleared here, at the one place every control row passes through,
            // rather than in each builder, so a new control type cannot forget it.
            if (widget instanceof Adw.PreferencesRow) widget.set_use_markup(false);
            this._control_panel.add(widget);
            this._controlRows.push(widget);
        }
        this._show_controls_button.set_active(true);
    }

    private _clearSidebar(): void {
        let child = this._sidebar_list.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            child.unparent();
            child = next;
        }
    }

    private _addCategoryToSidebar(category: string): void {
        const categoryRow = new Gtk.ListBoxRow({ selectable: false });

        const categoryLabel = new Gtk.Label({
            label: category,
            halign: Gtk.Align.START,
            margin_top: 10,
            margin_bottom: 4,
            margin_start: 12,
            margin_end: 12,
        });
        categoryLabel.add_css_class('heading');
        categoryLabel.add_css_class('dim-label');

        categoryRow.set_child(categoryLabel);
        this._sidebar_list.append(categoryRow);
    }

    private _addStoryToSidebar(story: StoryWidget, name: string): void {
        const storyRow = new Gtk.ListBoxRow() as StoryRow;
        const storyLabel = new Gtk.Label({
            label: name || 'Unnamed Story',
            halign: Gtk.Align.START,
            margin_start: 20,
            margin_top: 6,
            margin_bottom: 6,
        });

        storyRow.set_child(storyLabel);
        this._sidebar_list.append(storyRow);
        storyRow.storyWidget = story;
        this._rowByTitle.set(story.meta.title, storyRow);
    }

    private _clearControlPanel(): void {
        for (const row of this._controlRows) {
            this._control_panel.remove(row);
        }
        this._controlRows = [];
    }

    // --- devtools control surface (driven by @gjsify/devtools when enabled) ---

    /** The currently-displayed story, or null. */
    get activeStory(): StoryWidget | null {
        return this._controller.activeStory;
    }

    /**
     * Select + show a story by its full `Category/Name` title; the sidebar
     * selection updates too, so the UI stays in sync. Returns false when no
     * story with that title exists.
     */
    openStoryByTitle(title: string): boolean {
        return this._controller.openStoryByTitle(title);
    }

    /**
     * Set one arg on the active story — drives the same `args` path as the
     * control panel, so the visible control rows refresh via the controller's
     * args subscription. Returns false when no story is active.
     */
    setActiveArg(name: string, value: StoryArgValue): boolean {
        return this._controller.setActiveArg(name, value);
    }
}

GObject.type_ensure(StorybookWindow.$gtype);

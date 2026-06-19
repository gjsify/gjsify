// StorybookWindow — the generic component browser: a sidebar of stories grouped
// by category, a preview pane, and a controls panel that renders live-bound
// Adwaita rows from each story's controls. original implementation.
//
// The window tree is built programmatically rather than from a .blp template so
// the package is self-contained — a published library cannot rely on the
// blueprint build plugin (which only runs for `--app` bundles, not `--library`).

import Adw from '@girs/adw-1';
import Gdk from '@girs/gdk-4.0';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import {
    ControlType,
    type StoryArgValue,
    type StoryBooleanControl,
    type StoryColorControl,
    type StoryControl,
    type StoryNumberControl,
    type StorySelectControl,
    type StoryTextControl,
} from '@gjsify/stories';
import type { StoryModule, StoryWidget } from './story-widget.js';
import type { StoryRow } from './types.js';

/**
 * Main window for the storybook. The sidebar lists story instances grouped by
 * the `Category/Name` title prefix; the preview pane holds the active
 * {@link StoryWidget} and an `Adw.PreferencesGroup` of controls drives its
 * `args` with two-way binding.
 */
export class StorybookWindow extends Adw.ApplicationWindow {
    private _sidebar_list!: Gtk.ListBox;
    private _content_area!: Adw.Bin;
    private _control_panel!: Adw.PreferencesGroup;
    private _preview_title!: Adw.WindowTitle;
    private _show_controls_button!: Gtk.ToggleButton;
    private _controls_split_view!: Adw.OverlaySplitView;
    private _main_split_view!: Adw.NavigationSplitView;

    private _controlRows: Gtk.Widget[] = [];
    private _controlRefreshers: Array<(args: Record<string, unknown>) => void> = [];
    private _activeStoryHandlerId = 0;
    private _activeStory: StoryWidget | null = null;

    static {
        GObject.registerClass({ GTypeName: 'StorybookWindow' }, StorybookWindow);
    }

    constructor(params: Partial<Adw.ApplicationWindow.ConstructorProps>) {
        super(params);

        this.set_default_size(1200, 800);
        this.set_size_request(360, 320);
        this.set_title('Storybook');

        this._buildUI();

        this._sidebar_list.connect('row-selected', this._onStorySelected.bind(this));
        this._show_controls_button.connect('toggled', this._onToggleControls.bind(this));
        this._controls_split_view.set_show_sidebar(true);
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
        const sidebarToolbar = new Adw.ToolbarView({ content: sidebarScroll });
        sidebarToolbar.add_top_bar(sidebarHeader);
        const sidebarPage = new Adw.NavigationPage({ title: 'Stories', tag: 'stories', child: sidebarToolbar });

        // --- Preview content + controls overlay ---
        this._content_area = new Adw.Bin({ hexpand: true, vexpand: true });
        const contentScroll = new Gtk.ScrolledWindow({ hexpand: true, vexpand: true, child: this._content_area });

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
        const previewToolbar = new Adw.ToolbarView({ content: this._controls_split_view });
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

    /** Populate the sidebar with story instances grouped by category. */
    populateSidebar(storyModules: StoryModule[]): void {
        this._clearSidebar();

        if (!storyModules.some((module) => module.instances?.length)) {
            console.error('Story modules do not have instances. Call createStoryInstances first.');
            return;
        }

        const categories = this._groupStoriesByCategory(storyModules);

        categories.forEach((stories, category) => {
            this._addCategoryToSidebar(category);
            stories.forEach((story) => {
                this._addStoryToSidebar(story);
            });
        });
    }

    private _clearSidebar(): void {
        let child = this._sidebar_list.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            child.unparent();
            child = next;
        }
    }

    private _groupStoriesByCategory(storyModules: StoryModule[]): Map<string, StoryWidget[]> {
        const categories = new Map<string, StoryWidget[]>();

        storyModules.forEach((storyModule) => {
            if (!storyModule.instances?.length) return;

            storyModule.instances.forEach((storyInstance) => {
                const [category] = storyInstance.meta.title.split('/');
                if (!categories.has(category)) {
                    categories.set(category, []);
                }
                categories.get(category)!.push(storyInstance);
            });
        });

        return categories;
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

    private _addStoryToSidebar(story: StoryWidget): void {
        const titleParts = story.meta.title.split('/');
        const storyName = titleParts.length > 1 ? titleParts[1] : story.meta.title;

        const storyRow = new Gtk.ListBoxRow() as StoryRow;
        const storyLabel = new Gtk.Label({
            label: storyName || 'Unnamed Story',
            halign: Gtk.Align.START,
            margin_start: 20,
            margin_top: 6,
            margin_bottom: 6,
        });

        storyRow.set_child(storyLabel);
        this._sidebar_list.append(storyRow);
        storyRow.storyWidget = story;
    }

    private _onStorySelected(_listbox: Gtk.ListBox, row: Gtk.ListBoxRow | null): void {
        if (!row) return;

        const storyRow = row as StoryRow;
        if (!storyRow.storyWidget) return;

        this._showStory(storyRow.storyWidget);

        if (this._main_split_view.get_collapsed()) {
            this._main_split_view.set_show_content(true);
        }
    }

    private _showStory(storyWidget: StoryWidget): void {
        this._preview_title.set_title(`${storyWidget.meta.title} - ${storyWidget.story}`);
        this._content_area.set_child(storyWidget);
        this._updateControlPanel(storyWidget);
    }

    private _updateControlPanel(storyWidget: StoryWidget): void {
        this._clearControlPanel();

        const controls = storyWidget.meta.controls;
        if (!Array.isArray(controls)) return;

        controls.forEach((control) => {
            if (!control?.name || !control?.type) {
                console.warn('Invalid control configuration:', control);
                return;
            }
            const row = this._createControlRow(storyWidget, control);
            if (row) {
                this._control_panel.add(row);
                this._controlRows.push(row);
            }
        });

        // Subscribe to the story's `args` so external mutations (e.g. a toggle
        // clicked directly in the preview) refresh every control widget.
        if (this._activeStory && this._activeStoryHandlerId) {
            this._activeStory.disconnect(this._activeStoryHandlerId);
        }
        this._activeStory = storyWidget;
        this._activeStoryHandlerId = storyWidget.connect('notify::args', () => {
            for (const refresh of this._controlRefreshers) refresh(storyWidget.args);
        });

        this._show_controls_button.set_active(true);
    }

    private _clearControlPanel(): void {
        for (const row of this._controlRows) {
            this._control_panel.remove(row);
        }
        this._controlRows = [];
        this._controlRefreshers = [];
    }

    private _createControlRow(storyWidget: StoryWidget, control: StoryControl): Gtk.Widget | null {
        const currentValue = storyWidget.args[control.name];

        switch (control.type) {
            case ControlType.TEXT:
                return this._createTextRow(storyWidget, control, typeof currentValue === 'string' ? currentValue : '');

            case ControlType.NUMBER:
                return this._createNumberRow(
                    storyWidget,
                    control,
                    typeof currentValue === 'number' ? currentValue : (control.min ?? 0),
                );

            case ControlType.BOOLEAN:
                return this._createBooleanRow(
                    storyWidget,
                    control,
                    typeof currentValue === 'boolean' ? currentValue : false,
                );

            case ControlType.RANGE:
                return this._createRangeRow(
                    storyWidget,
                    control,
                    typeof currentValue === 'number' ? currentValue : (control.min ?? 0),
                );

            case ControlType.SELECT:
                return this._createSelectRow(storyWidget, control, currentValue ?? null);

            case ControlType.COLOR:
                return this._createColorRow(
                    storyWidget,
                    control,
                    typeof currentValue === 'string' ? currentValue : '#000000',
                );

            default:
                console.warn(`Unsupported control type: ${(control as StoryControl).type}`);
                return null;
        }
    }

    private _writeArg(storyWidget: StoryWidget, name: string, value: StoryArgValue): void {
        storyWidget.args = { ...storyWidget.args, [name]: value };
    }

    private _createTextRow(storyWidget: StoryWidget, config: StoryTextControl, current: string): Adw.EntryRow {
        const row = new Adw.EntryRow({ title: config.label || config.name });
        row.set_text(current);
        if (config.description) row.set_tooltip_text(config.description);
        row.connect('changed', () => this._writeArg(storyWidget, config.name, row.get_text()));
        this._controlRefreshers.push((args) => {
            const next = typeof args[config.name] === 'string' ? (args[config.name] as string) : '';
            if (row.get_text() !== next) row.set_text(next);
        });
        return row;
    }

    private _createNumberRow(storyWidget: StoryWidget, config: StoryNumberControl, current: number): Adw.SpinRow {
        const row = Adw.SpinRow.new_with_range(config.min ?? 0, config.max ?? 100, config.step ?? 1);
        row.set_title(config.label || config.name);
        if (config.description) row.set_subtitle(config.description);
        row.set_value(current);
        row.connect('changed', () => this._writeArg(storyWidget, config.name, row.get_value()));
        this._controlRefreshers.push((args) => {
            const next = typeof args[config.name] === 'number' ? (args[config.name] as number) : 0;
            if (row.get_value() !== next) row.set_value(next);
        });
        return row;
    }

    private _createBooleanRow(storyWidget: StoryWidget, config: StoryBooleanControl, current: boolean): Adw.SwitchRow {
        const row = new Adw.SwitchRow({
            title: config.label || config.name,
            subtitle: config.description ?? '',
            active: current,
        });
        row.connect('notify::active', () => this._writeArg(storyWidget, config.name, row.get_active()));
        this._controlRefreshers.push((args) => {
            const next = Boolean(args[config.name]);
            if (row.get_active() !== next) row.set_active(next);
        });
        return row;
    }

    private _createRangeRow(storyWidget: StoryWidget, config: StoryNumberControl, current: number): Gtk.Widget {
        const min = config.min ?? 0;
        const max = config.max ?? 100;
        const step = config.step ?? 1;
        const shouldRound = Number.isInteger(step) && Number.isInteger(current);

        const adjustment = new Gtk.Adjustment({
            lower: min,
            upper: max,
            step_increment: step,
            value: current,
        });
        adjustment.step_increment = step;

        // Vertical card so the label + description don't get squashed into a
        // single-letter column when the controls sidebar is narrow.
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

        const valueLabel = new Gtk.Label({
            label: this._formatRangeValue(current, shouldRound),
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

        scale.connect('value-changed', () => {
            let value = scale.get_value();
            if (shouldRound) {
                const rounded = Math.round(value);
                if (rounded !== value) {
                    scale.set_value(rounded);
                    return;
                }
                value = rounded;
            }
            valueLabel.set_label(this._formatRangeValue(value, shouldRound));
            this._writeArg(storyWidget, config.name, value);
        });

        box.append(scale);
        row.set_child(box);

        this._controlRefreshers.push((args) => {
            const value = typeof args[config.name] === 'number' ? (args[config.name] as number) : current;
            if (scale.get_value() !== value) {
                scale.set_value(value);
                valueLabel.set_label(this._formatRangeValue(value, shouldRound));
            }
        });
        return row;
    }

    private _formatRangeValue(value: number, asInteger: boolean): string {
        return asInteger ? String(Math.round(value)) : value.toFixed(2);
    }

    private _createSelectRow(
        storyWidget: StoryWidget,
        config: StorySelectControl,
        current: StoryArgValue,
    ): Adw.ComboRow | null {
        const options = config.options;
        if (!options?.length) {
            console.warn(`SELECT control "${config.name}" has no options`);
            return null;
        }

        const model = Gtk.StringList.new(options.map((opt) => opt.label));
        const row = new Adw.ComboRow({
            title: config.label || config.name,
            subtitle: config.description ?? '',
            model,
        });

        const selected = options.findIndex((opt) => opt.value === current);
        if (selected >= 0) row.set_selected(selected);

        row.connect('notify::selected', () => {
            const idx = row.get_selected();
            if (idx >= 0 && idx < options.length) {
                this._writeArg(storyWidget, config.name, options[idx].value);
            }
        });

        this._controlRefreshers.push((args) => {
            const value = args[config.name];
            const idx = options.findIndex((opt) => opt.value === value);
            if (idx >= 0 && row.get_selected() !== idx) row.set_selected(idx);
        });

        return row;
    }

    private _createColorRow(storyWidget: StoryWidget, config: StoryColorControl, current: string): Adw.ActionRow {
        const row = new Adw.ActionRow({
            title: config.label || config.name,
            subtitle: config.description ?? '',
        });

        const button = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({ title: config.label || config.name }),
            valign: Gtk.Align.CENTER,
        });

        const initial = new Gdk.RGBA();
        if (initial.parse(current)) {
            button.set_rgba(initial);
        }

        button.connect('notify::rgba', () => {
            this._writeArg(storyWidget, config.name, this._rgbaToHex(button.get_rgba()));
        });

        row.add_suffix(button);
        row.set_activatable_widget(button);
        return row;
    }

    private _rgbaToHex(rgba: Gdk.RGBA): string {
        const channel = (v: number) =>
            Math.round(Math.max(0, Math.min(1, v)) * 255)
                .toString(16)
                .padStart(2, '0');
        return `#${channel(rgba.red)}${channel(rgba.green)}${channel(rgba.blue)}`;
    }
}

GObject.type_ensure(StorybookWindow.$gtype);

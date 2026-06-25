// Native GJS + Libadwaita (GTK4) reference page.
//
// Renders a fixed Adwaita preferences page with REAL @girs/adw-1 widgets and
// captures the window to a PNG via the GSK renderer. The PNG is the "original
// Adwaita" gold reference for a visual diff against a sibling NativeScript port.
//
// Capture idiom adapted from packages/framework/devtools/src/screenshot.ts
// (Gtk.WidgetPaintable -> Gsk.Renderer.render_texture -> Gdk.Texture.save_to_png_bytes).

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Graphene from 'gi://Graphene?version=1.0';
import Gtk from 'gi://Gtk?version=4.0';

const OUT_PATH =
    GLib.getenv('ADWAITA_REFERENCE_OUT') ??
    '/tmp/claude-1000/-home-jumplink-Projekte-gjsify/41622447-0cd0-45ba-8bd4-db6a0b581ee6/scratchpad/gtk-original.png';

/** Render a realized widget (the toplevel window) to PNG bytes via the GSK renderer. */
function captureWidgetPng(widget: Gtk.Widget): Uint8Array | null {
    const native = widget.get_native();
    const renderer = native?.get_renderer();
    if (!renderer) return null;

    const width = widget.get_width();
    const height = widget.get_height();
    if (width <= 0 || height <= 0) return null;

    const paintable = Gtk.WidgetPaintable.new(widget);
    const snapshot = Gtk.Snapshot.new();
    paintable.snapshot(snapshot, width, height);
    const node = snapshot.to_node();
    if (!node) return null;

    const viewport = new Graphene.Rect();
    viewport.init(0, 0, width, height);
    const texture = renderer.render_texture(node, viewport);

    const data = texture.save_to_png_bytes().get_data();
    return data ? new Uint8Array(data) : null;
}

function buildContent(): Gtk.Widget {
    const page = new Adw.PreferencesPage();

    // --- Group: Appearance ---
    const appearance = new Adw.PreferencesGroup({ title: 'Appearance' });

    const darkRow = new Adw.SwitchRow({
        title: 'Dark mode',
        subtitle: 'Use the dark Adwaita palette',
        active: false,
    });
    appearance.add(darkRow);

    const notifyRow = new Adw.SwitchRow({
        title: 'Notifications',
        subtitle: 'Show toasts for events',
        active: true,
    });
    appearance.add(notifyRow);

    const accentRow = new Adw.ComboRow({
        title: 'Accent color',
        model: Gtk.StringList.new(['Blue', 'Teal', 'Green', 'Orange']),
        selected: 0,
    });
    appearance.add(accentRow);

    page.add(appearance);

    // --- Group: Account ---
    const account = new Adw.PreferencesGroup({ title: 'Account' });

    const nameRow = new Adw.EntryRow({ title: 'Name' });
    nameRow.set_text('Ada Lovelace');
    account.add(nameRow);

    const emailRow = new Adw.EntryRow({ title: 'Email' });
    emailRow.set_text('ada@example.com');
    account.add(emailRow);

    const devicesRow = new Adw.SpinRow({
        title: 'Devices',
        adjustment: new Gtk.Adjustment({
            value: 3,
            lower: 1,
            upper: 10,
            step_increment: 1,
            page_increment: 1,
        }),
    });
    // The SpinRow's displayed value doesn't always sync from the adjustment during
    // property init ordering — set it explicitly so the row reads "3".
    devicesRow.set_value(3);
    account.add(devicesRow);

    const advanced = new Adw.ExpanderRow({
        title: 'Advanced',
        subtitle: 'More options',
        expanded: true,
    });
    const syncRow = new Adw.SwitchRow({ title: 'Sync', active: true });
    advanced.add_row(syncRow);
    const exportRow = new Adw.ActionRow({ title: 'Export' });
    advanced.add_row(exportRow);
    account.add(advanced);

    page.add(account);

    // --- Group: Actions (button row) ---
    const actions = new Adw.PreferencesGroup({ title: 'Actions' });
    const buttonBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 12,
        homogeneous: true,
        margin_top: 6,
        margin_bottom: 6,
    });
    const saveButton = new Gtk.Button({ label: 'Save changes' });
    saveButton.add_css_class('suggested-action');
    buttonBox.append(saveButton);
    const deleteButton = new Gtk.Button({ label: 'Delete account' });
    deleteButton.add_css_class('destructive-action');
    buttonBox.append(deleteButton);
    actions.add(buttonBox);

    page.add(actions);

    return page;
}

function buildWindow(app: Adw.Application): Adw.ApplicationWindow {
    const window = new Adw.ApplicationWindow({
        application: app,
        title: 'Adwaita Widgets',
        default_width: 420,
        default_height: 900,
    });

    const toolbarView = new Adw.ToolbarView();

    const headerBar = new Adw.HeaderBar();
    headerBar.set_title_widget(new Adw.WindowTitle({ title: 'Adwaita Widgets', subtitle: '' }));

    // Avatar in the header end.
    const avatar = new Adw.Avatar({ size: 48, text: 'Ada Lovelace', show_initials: true });
    headerBar.pack_end(avatar);

    toolbarView.add_top_bar(headerBar);

    // Banner sits below the header bar, above the page content.
    const banner = new Adw.Banner({
        title: 'You have unsaved changes',
        'button-label': 'Save',
        revealed: true,
    });
    toolbarView.add_top_bar(banner);

    toolbarView.set_content(buildContent());

    // Belt-and-suspenders: ensure the page area paints the Adwaita window
    // background (light = #fafafb) even if a captured node misses the window's
    // own bg fill. `.background` is the libadwaita/GTK class that draws
    // @window_bg_color behind a widget.
    toolbarView.add_css_class('background');

    window.set_content(toolbarView);
    return window;
}

const app = new Adw.Application({
    application_id: 'gjsify.examples.gtk.adwaita-reference',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

// Force the light Adwaita palette, hard, as early as possible. This machine's
// GNOME may be set to prefer-dark; without forcing light here libadwaita pulls
// dark-influenced surface colors. `startup` fires after Adw/GTK init (so
// StyleManager.get_default() is valid) but before any window is built.
app.connect('startup', () => {
    Adw.StyleManager.get_default().set_color_scheme(Adw.ColorScheme.FORCE_LIGHT);
});

app.connect('activate', () => {
    // Re-assert in case the manager reset on activation.
    Adw.StyleManager.get_default().set_color_scheme(Adw.ColorScheme.FORCE_LIGHT);

    let window = app.get_active_window() as Adw.ApplicationWindow | null;
    if (!window) window = buildWindow(app);
    window.present();

    // Give the compositor time to realize + lay out + paint, then capture.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
        try {
            // Capture the toplevel window itself — its render node includes the
            // Adwaita @window_bg_color fill (light = #fafafb) drawn behind the
            // content. Snapshotting the inner content widget would omit it.
            const target: Gtk.Widget = window;
            const png = captureWidgetPng(target);
            if (png) {
                const file = Gio.File.new_for_path(OUT_PATH);
                file.replace_contents(png, null, false, Gio.FileCreateFlags.NONE, null);
                print(`[adwaita-reference] wrote ${png.length} bytes -> ${OUT_PATH}`);
            } else {
                printerr('[adwaita-reference] capture returned null (widget not realized / no renderer)');
            }
        } catch (e) {
            printerr(`[adwaita-reference] capture failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            app.quit();
        }
        return GLib.SOURCE_REMOVE;
    });
});

app.run([]);

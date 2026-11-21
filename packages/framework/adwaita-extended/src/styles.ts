import Gdk from '@girs/gdk-4.0';
import Gtk from '@girs/gtk-4.0';

/** The package's few fixed rules; everything per-instance goes through {@link Tint}. */
const CSS = `
.gjsify-source-dot { border-radius: 50%; min-width: 8px; min-height: 8px; }
.gjsify-source-dot.large { min-width: 14px; min-height: 14px; }
.gjsify-board-column { background-color: alpha(currentColor, 0.05); border-radius: 12px; }
.gjsify-board-card { padding: 0; }
.gjsify-board-bar { min-width: 4px; border-radius: 6px 0 0 6px; }
.gjsify-board-label { padding: 0 6px; border-radius: 99px; background-color: alpha(currentColor, 0.1); }
.gjsify-board-card.gjsify-board-dragging { opacity: 0.4; }
.gjsify-board-card.gjsify-board-drop-above { box-shadow: inset 0 3px 0 0 @accent_bg_color; }
.gjsify-board-card.gjsify-board-drop-below { box-shadow: inset 0 -3px 0 0 @accent_bg_color; }
.gjsify-board-column.gjsify-board-drop-into { box-shadow: inset 0 0 0 2px @accent_bg_color; }
.gjsify-board-avatar:not(:first-child) { margin-left: -6px; }
.gjsify-board-avatar { border: 2px solid @card_bg_color; border-radius: 50%; }
.gjsify-filter-chip { padding: 2px 2px 2px 10px; border-radius: 99px; background-color: @accent_bg_color; color: @accent_fg_color; }
.gjsify-filter-chip button { min-width: 20px; min-height: 20px; padding: 0; border-radius: 99px; }
.gjsify-filter-chip button:hover { background-color: alpha(@accent_fg_color, 0.12); }
.gjsify-swipe-content { background-color: @view_bg_color; }
.gjsify-swipe-backdrop.primary { background-color: @success_bg_color; color: @success_fg_color; }
.gjsify-swipe-backdrop.secondary { background-color: @warning_bg_color; color: @warning_fg_color; }
.gjsify-swipe-backdrop image { opacity: 0.55; }
.gjsify-swipe-backdrop.armed image { opacity: 1; }
.gjsify-swipe-actions button { min-width: 32px; min-height: 32px; }
.gjsify-month-head { padding: 0 6px; min-height: 24px; border-radius: 99px; }
.gjsify-month-head.today { background-color: @accent_bg_color; color: @accent_fg_color; }
.gjsify-month-head.other-month { opacity: 0.45; }
.gjsify-month-week { border-top: 1px solid alpha(currentColor, 0.12); }
.gjsify-month-bar { min-height: 18px; padding: 0 6px; border-radius: 6px; background-color: alpha(currentColor, 0.12); }
.gjsify-month-bar.continues-left { border-top-left-radius: 0; border-bottom-left-radius: 0; }
.gjsify-month-bar.continues-right { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.gjsify-month-more { padding: 0 6px; min-height: 16px; }
.gjsify-week-number { padding: 0 4px; }
.gjsify-time-hour { border-top: 1px solid alpha(currentColor, 0.12); }
.gjsify-time-column { border-left: 1px solid alpha(currentColor, 0.12); }
.gjsify-time-event { border-radius: 6px; padding: 1px 5px; background-color: color-mix(in srgb, currentColor 15%, @window_bg_color); }
.gjsify-time-now { background-color: @error_color; min-height: 2px; }
.gjsify-time-strip { border-bottom: 1px solid alpha(currentColor, 0.12); }
.gjsify-agenda-header { padding: 10px 12px 2px 12px; }
`;

let loaded = false;

/** Once per process; a no-op without a display (Node-side tooling, a headless import). */
export function ensureStyles(): void {
    if (loaded) return;
    const display = Gdk.Display.get_default();
    if (!display) return;
    const provider = new Gtk.CssProvider();
    provider.load_from_string(CSS);
    Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    loaded = true;
}

/** `Pango.EllipsizeMode.END`; spelled as a number so the package needs no `@girs/pango` dependency. */
export const ELLIPSIZE_END = 3;

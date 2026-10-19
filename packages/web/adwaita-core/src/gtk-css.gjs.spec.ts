// THE ORACLE: the GTK_CSS_VECTORS run against real `Gtk.CssProvider`s on a real display. A vector that
// fails here is a wrong vector; fix the vector. Windows are presented, so run it under
// `scripts/headless-run`. `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`, so the dynamic `gi://`
// loads do not count.

import { describe, expect, it, on } from '@gjsify/unit';

import {
    driveGtkCssVectors,
    GTK_CSS_VECTORS,
    type GtkCssNode,
    type GtkCssReading,
    type GtkCssReadingKey,
    type GtkCssScene,
} from './conformance/gtk-css.js';

type Obj = Record<string, (...args: unknown[]) => unknown>;
// oxlint-disable-next-line typescript/no-explicit-any -- gi:// modules are untyped in this package
type Gi = any;

export default async () => {
    await on('Gjs', async () => {
        const Gtk: Gi = (await import('gi://Gtk?version=4.0' as string)).default;
        const Gdk: Gi = (await import('gi://Gdk?version=4.0' as string)).default;
        const GLib: Gi = (await import('gi://GLib?version=2.0' as string)).default;
        const Graphene: Gi = (await import('gi://Graphene?version=1.0' as string)).default;
        if (!Gtk.init_check()) return;

        const c = (o: object, m: string, ...a: unknown[]) => (o as Obj)[m]!(...a);
        const context = GLib.MainContext.default();

        // State changes reach the paint only after a frame; idle iterations alone are not enough.
        function settle(): void {
            let done = false;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                done = true;
                return false;
            });
            while (!done) context.iteration(true);
        }

        function build(node: GtkCssNode, probes: Map<string, object>, groups: Map<string, object>): object {
            const widget =
                node.widget === 'GtkBox'
                    ? new Gtk.Box()
                    : new Gtk.CheckButton(
                          node.group && groups.has(node.group) ? { group: groups.get(node.group) } : {},
                      );
            if (node.widget === 'GtkCheckButton' && node.group && !groups.has(node.group)) {
                groups.set(node.group, widget);
            }
            for (const name of node.classes ?? []) c(widget, 'add_css_class', name);
            if (node.name) c(widget, 'set_name', node.name);
            for (const child of node.children ?? []) c(widget, 'append', build(child, probes, groups));
            if (node.id) probes.set(node.id, widget);
            return widget;
        }

        function applyState(node: GtkCssNode, probes: Map<string, object>): void {
            const widget = node.id ? probes.get(node.id) : undefined;
            if (widget && node.active !== undefined) c(widget, 'set_active', node.active);
            if (widget && node.sensitive !== undefined) c(widget, 'set_sensitive', node.sensitive);
            for (const child of node.children ?? []) applyState(child, probes);
        }

        function pixels(window: object, widget: object): (x: number, y: number) => number[] {
            const paintable = new Gtk.WidgetPaintable({ widget });
            const width = paintable.get_intrinsic_width();
            const height = paintable.get_intrinsic_height();
            const snapshot = new Gtk.Snapshot();
            paintable.snapshot(snapshot, width, height);
            const renderer = c(c(window, 'get_native') as object, 'get_renderer') as Gi;
            const rect = new Graphene.Rect({
                origin: new Graphene.Point({ x: 0, y: 0 }),
                size: new Graphene.Size({ width, height }),
            });
            const downloader = Gdk.TextureDownloader.new(renderer.render_texture(snapshot.to_node(), rect));
            downloader.set_format(Gdk.MemoryFormat.R8G8B8A8);
            const [bytes, stride] = downloader.download_bytes();
            const data = bytes.get_data() as Uint8Array;
            return (x, y) => {
                const offset = y * stride + x * 4;
                return [data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!];
            };
        }

        function read(window: object, widget: Gi, keys: readonly GtkCssReadingKey[]): GtkCssReading {
            const out: Record<string, unknown> = {};
            if (keys.includes('color')) out.color = widget.get_color().to_string();
            if (keys.includes('size')) {
                out.size = [
                    widget.measure(Gtk.Orientation.HORIZONTAL, -1)[0],
                    widget.measure(Gtk.Orientation.VERTICAL, -1)[0],
                ];
            }
            if (keys.includes('center') || keys.includes('edge')) {
                const paintable = new Gtk.WidgetPaintable({ widget });
                const width = paintable.get_intrinsic_width();
                const height = paintable.get_intrinsic_height();
                const at = pixels(window, widget);
                if (keys.includes('center')) out.center = at(width >> 1, height >> 1);
                if (keys.includes('edge')) out.edge = at(width >> 1, 1);
            }
            return out as GtkCssReading;
        }

        await driveGtkCssVectors(
            {
                name: 'GJS (real Gtk.CssProvider)',
                isOracle: true,
                async render(scene: GtkCssScene, reads) {
                    const display = Gdk.Display.get_default();
                    const errors: string[] = [];
                    const providers = scene.sheets.map(({ css, priority }) => {
                        const provider = new Gtk.CssProvider();
                        provider.connect('parsing-error', (_p: unknown, section: Gi, error: Gi) => {
                            const start = section.get_start_location();
                            errors.push(`${start.lines + 1}:${start.line_chars + 1}: ${error.message}`);
                        });
                        provider.load_from_string(css);
                        Gtk.StyleContext.add_provider_for_display(display, provider, priority);
                        return provider;
                    });
                    const probes = new Map<string, object>();
                    const window = new Gtk.Window();
                    c(window, 'set_child', build(scene.tree, probes, new Map()));
                    c(window, 'present');
                    settle();
                    applyState(scene.tree, probes);
                    settle();
                    const result: Record<string, GtkCssReading> = {};
                    for (const [id, keys] of Object.entries(reads)) result[id] = read(window, probes.get(id), keys);
                    c(window, 'destroy');
                    for (const provider of providers) Gtk.StyleContext.remove_provider_for_display(display, provider);
                    return { errors, probes: result };
                },
            },
            { describe, it, expect },
            GTK_CSS_VECTORS,
        );
    });
};

// THE ORACLE: the CAROUSEL_DOOR_VECTORS run against a real `gi://Adw` carousel in a presented
// window. A vector that fails here is a wrong vector; fix the vector. Run it under
// `scripts/headless-run`. `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`.

import { describe, expect, it, on } from '@gjsify/unit';

import {
    CAROUSEL_DOOR_VECTORS,
    driveCarouselDoorVectors,
    type CarouselDoorLike,
    type CarouselDoorSubject,
} from './conformance/carousel-doors.js';

type Obj = Record<string, (...args: unknown[]) => unknown>;
interface GtkModule {
    init_check(): boolean;
    Window: new (params?: Record<string, unknown>) => object;
    Label: new (params?: Record<string, unknown>) => object;
}
interface AdwModule {
    init(): void;
    Carousel: new () => CarouselDoorLike;
}
interface MainContextLike {
    iteration(mayBlock: boolean): boolean;
}
interface GLibModule {
    MainContext: { default(): MainContextLike };
    get_monotonic_time(): number;
    timeout_add(priority: number, ms: number, callback: () => boolean): number;
    PRIORITY_DEFAULT: number;
}

/** Long enough for the carousel's spring animation to come to rest. */
const SETTLE_MS = 600;

export default async () => {
    await on('Gjs', async () => {
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default as GtkModule;
        const GLib = (await import('gi://GLib?version=2.0' as string)).default as GLibModule;
        const Adw = (await import('gi://Adw?version=1' as string)).default as AdwModule;
        if (!Gtk.init_check()) return;
        Adw.init();

        const c = (o: object, m: string, ...a: unknown[]) => (o as Obj)[m]!(...a);
        const windows: object[] = [];
        const subject: CarouselDoorSubject = {
            name: 'GJS (real Adw.Carousel)',
            isOracle: true,
            makeCarousel(count) {
                const carousel = new Adw.Carousel();
                const pages = Array.from({ length: count }, (_unused, i) => new Gtk.Label({ label: `Page ${i}` }));
                for (const page of pages) c(carousel, 'append', page);
                const window = new Gtk.Window({ default_width: 300, default_height: 200 });
                c(window, 'set_child', carousel);
                c(window, 'present');
                windows.push(window);
                return { carousel, pages };
            },
            makeStranger: () => new Gtk.Label({ label: 'Stranger' }),
            async settle() {
                const context = GLib.MainContext.default();
                const until = GLib.get_monotonic_time() + SETTLE_MS * 1000;
                // A tick source keeps a blocking iteration from waiting past the deadline.
                const tick = () => GLib.get_monotonic_time() < until;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, tick);
                while (tick()) context.iteration(true);
                while (context.iteration(false));
            },
            dispose() {
                for (const window of windows.splice(0)) c(window, 'destroy');
            },
        };
        await driveCarouselDoorVectors(subject, { describe, it, expect }, CAROUSEL_DOOR_VECTORS);
    });
};

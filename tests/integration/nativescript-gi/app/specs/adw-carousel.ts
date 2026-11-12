// `Adw.Carousel` ON A DEVICE (ADR 0105 § 2, route D) — `position` and `n-pages` declared with
// `withSignals(GridLayout, …)`. The vectors are libadwaita's, measured on real Adw;
// `adw-carousel-route-d.node-gi.spec.ts` runs them off-device on the real-GI engine.
//
// Both properties are read-only upstream; the port's `CarouselState` is the source of truth.
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';

import { describe, expect, info, it } from '../reporter.js';

const POSITION = 'notify::position';
const N_PAGES = 'notify::n-pages';

const watch = (carousel: Adw.Carousel): string[] => {
    const seen: string[] = [];
    carousel.connect(POSITION, () => seen.push(POSITION));
    carousel.connect(N_PAGES, () => seen.push(N_PAGES));
    return seen;
};

export const adwCarouselSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    await describe(`Adw.Carousel on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('starts empty at position 0, having emitted nothing', () => {
            const carousel = new Adw.Carousel();
            const seen = watch(carousel);
            expect(carousel.nPages).toBe(0);
            expect(carousel.position).toBe(0);
            expect(seen.length).toBe(0);
        });

        await it('appending a page emits notify::n-pages once, a later one again', () => {
            const carousel = new Adw.Carousel();
            const seen = watch(carousel);
            carousel.append(new Gtk.Label());
            info(`seen=${seen.join('|')}`);
            expect(carousel.nPages).toBe(1);
            expect(seen.filter((name) => name === N_PAGES).length).toBe(1);
            carousel.append(new Gtk.Label());
            expect(carousel.nPages).toBe(2);
            expect(seen.filter((name) => name === N_PAGES).length).toBe(2);
        });

        await it('removing a page emits notify::n-pages once', () => {
            const carousel = new Adw.Carousel();
            const first = new Gtk.Label();
            carousel.append(first);
            carousel.append(new Gtk.Label());
            const seen = watch(carousel);
            carousel.remove(first);
            info(`seen=${seen.join('|')}`);
            expect(carousel.nPages).toBe(1);
            expect(seen.filter((name) => name === N_PAGES).length).toBe(1);
        });

        await it('n-pages is read-only: a write resolves to the count the model holds and emits nothing', () => {
            const carousel = new Adw.Carousel();
            carousel.append(new Gtk.Label());
            const seen = watch(carousel);
            (carousel as unknown as { nPages: unknown }).nPages = 7;
            expect(carousel.nPages).toBe(1);
            expect(seen.length).toBe(0);
        });

        await it('scrolling to a page moves position and emits notify::position', () => {
            const carousel = new Adw.Carousel();
            carousel.append(new Gtk.Label());
            const second = new Gtk.Label();
            carousel.append(second);
            const seen = watch(carousel);
            carousel.scroll_to(second, false);
            info(`seen=${seen.join('|')}`);
            expect(carousel.position).toBe(1);
            expect(seen.filter((name) => name === POSITION).length > 0).toBe(true);
        });

        await it('writing position scrolls to the page it settles on', () => {
            const carousel = new Adw.Carousel();
            carousel.append(new Gtk.Label());
            carousel.append(new Gtk.Label());
            const seen = watch(carousel);
            carousel.position = 1;
            expect(carousel.position).toBe(1);
            expect(seen.filter((name) => name === POSITION).length > 0).toBe(true);
        });
    });
};

export default adwCarouselSpec;

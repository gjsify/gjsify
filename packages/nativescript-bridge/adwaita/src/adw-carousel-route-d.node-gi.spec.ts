// ROUTE D OFF A DEVICE: `Adw.Carousel`'s declared `position` and `n-pages` properties, with the
// port's store replaced by real GObject through `@gjsify/node-gi` (ADR 0105 stage 2).
//
// `AdwCarousel` is `withSignals(GridLayout, …)`. Both properties are read-only upstream
// (`G_PARAM_READABLE`) and `explicitNotify`: `CarouselState` is the source of truth and its
// subscriber pushes the value and emits. `tests/integration/nativescript-gi/app/specs/adw-carousel.ts`
// runs the same vectors on the device.
//
// MEASURED ON REAL LIBADWAITA (the `measureReal` leg below re-measures the behavior that
// decided the port):
//   - appending a page emits `notify::n-pages` once, for the first page and for a later one.
//   - removing a page emits it once.
//   - reordering emits neither.
//   - a carousel that has never been allocated keeps `position` at 0: nothing scrolls it.
//
// `@gjsify/node-gi` is named only in `./test.node-gi.mts`, which hands `requireGi` to this factory.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import * as GObject from './namespace/gobject.js';

const loose = (widget: object): Record<string, unknown> => widget as unknown as Record<string, unknown>;

const POSITION = 'notify::position';
const N_PAGES = 'notify::n-pages';

function watch(carousel: Adw.Carousel): string[] {
    const seen: string[] = [];
    carousel.connect(POSITION, () => seen.push(POSITION));
    carousel.connect(N_PAGES, () => seen.push(N_PAGES));
    return seen;
}

/** What the real-Adw child process measured. */
export interface RealAdwCarouselMeasurement {
    readonly addFirst: { readonly seen: string[]; readonly nPages: number; readonly position: number };
    readonly addSecond: { readonly seen: string[]; readonly nPages: number; readonly position: number };
    readonly removeLast: { readonly seen: string[]; readonly nPages: number };
    readonly reorder: { readonly seen: string[]; readonly nPages: number };
}

/**
 * Runs the real-Adw measurement and returns what it saw. It is handed in, not done here: real
 * `Adw.Carousel` and the port's `AdwCarousel` both want the GType name `AdwCarousel`, so the two
 * cannot share a process. The host entry runs it in a child node process.
 */
export type RealAdwCarouselMeasurementFn = () => RealAdwCarouselMeasurement;

export const createAdwCarouselRouteDNodeGiTest = (measureReal: RealAdwCarouselMeasurementFn) => async () => {
    await describe('the engine this leg runs on', async () => {
        await it('is real GObject, so these cases are route D and not the seam’s own accessors', () => {
            expect(GObject.engineName).toBe('real-gio');
        });
    });

    await describe('a REAL Adw.Carousel (the measurement behind the port)', async () => {
        await it('emits notify::n-pages once per added or removed page, and nothing for a reorder', () => {
            const measured = measureReal();
            expect(measured.addFirst.seen).toStrictEqual([N_PAGES]);
            expect(measured.addFirst.nPages).toBe(1);
            expect(measured.addFirst.position).toBe(0);
            expect(measured.addSecond.seen).toStrictEqual([N_PAGES]);
            expect(measured.addSecond.nPages).toBe(2);
            expect(measured.removeLast.seen).toStrictEqual([N_PAGES]);
            expect(measured.removeLast.nPages).toBe(1);
            expect(measured.reorder.seen).toStrictEqual([]);
            expect(measured.reorder.nPages).toBe(2);
        });
    });

    await describe('Adw.Carousel over real GObject (route D)', async () => {
        await it('registers its own GType over a foreign NativeScript parent', () => {
            const carousel = new Adw.Carousel();
            expect(typeof loose(Adw.Carousel).$gtype).toBe('object');
            expect(loose(carousel).$typeName).toBe('AdwCarousel');
        });

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
            expect(carousel.nPages).toBe(1);
            expect(seen.filter((name) => name === N_PAGES)).toStrictEqual([N_PAGES]);
            carousel.append(new Gtk.Label());
            expect(carousel.nPages).toBe(2);
            expect(seen.filter((name) => name === N_PAGES)).toStrictEqual([N_PAGES, N_PAGES]);
        });

        await it('removing a page emits notify::n-pages once', () => {
            const carousel = new Adw.Carousel();
            const first = new Gtk.Label();
            carousel.append(first);
            carousel.append(new Gtk.Label());
            const seen = watch(carousel);
            carousel.remove(first);
            expect(carousel.nPages).toBe(1);
            expect(seen.filter((name) => name === N_PAGES)).toStrictEqual([N_PAGES]);
        });

        await it('n-pages is read-only: a write resolves to the count the model holds and emits nothing', () => {
            const carousel = new Adw.Carousel();
            carousel.append(new Gtk.Label());
            const seen = watch(carousel);
            (loose(carousel) as { nPages: unknown }).nPages = 7;
            expect(carousel.nPages).toBe(1);
            expect(seen).toStrictEqual([]);
        });

        await it('position follows the model: scrolling to a page moves it and emits notify::position', () => {
            const carousel = new Adw.Carousel();
            const first = new Gtk.Label();
            const second = new Gtk.Label();
            carousel.append(first);
            carousel.append(second);
            const seen = watch(carousel);
            carousel.scroll_to(second, false);
            expect(carousel.position).toBe(1);
            expect(seen.filter((name) => name === POSITION).length).toBeGreaterThan(0);
        });

        await it('writing position scrolls to the page it settles on, as the port always did', () => {
            const carousel = new Adw.Carousel();
            carousel.append(new Gtk.Label());
            carousel.append(new Gtk.Label());
            const seen = watch(carousel);
            carousel.position = 1;
            expect(carousel.position).toBe(1);
            expect(seen.filter((name) => name === POSITION).length).toBeGreaterThan(0);
        });

        await it('a bound property follows position through the real engine', () => {
            const carousel = new Adw.Carousel();
            carousel.append(new Gtk.Label());
            const second = new Gtk.Label();
            carousel.append(second);
            const seen: number[] = [];
            carousel.connect(POSITION, () => seen.push(carousel.position));
            carousel.scroll_to(second, false);
            expect(seen[seen.length - 1]).toBe(1);
        });
    });
};

export default createAdwCarouselRouteDNodeGiTest;

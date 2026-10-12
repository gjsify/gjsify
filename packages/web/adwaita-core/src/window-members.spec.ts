// The shared Gtk.Window members (window-members.ts) against the conformance vectors, through a
// minimal window built from the core pieces alone. Real GJS holds the same vectors in
// `window.gjs.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';

import { driveWindowVectors, WINDOW_VECTORS, type WindowSubject } from './conformance/window-members.js';
import { CloseRequestState, HandledAccumulator, WindowMemberState } from './window-members.js';

type Handler = (...args: unknown[]) => unknown;

class FakeWindow {
    readonly handlers = new Map<string, Handler[]>();
    readonly state = new WindowMemberState<object>((property) => this.emit(`notify::${property}`));
    readonly closing = new CloseRequestState();
    realized = false;
    visible = false;
    hideOnClose = false;
    readonly widgets: [object, object] = [{}, {}];

    emit(signal: string, ...args: unknown[]): void {
        for (const handler of this.handlers.get(signal) ?? []) handler(...args);
    }

    close(): void {
        this.closing.close({
            realized: this.realized,
            hideOnClose: this.hideOnClose,
            emit: () => {
                const accumulator = new HandledAccumulator();
                for (const handler of this.handlers.get('close-request') ?? []) {
                    if (accumulator.stopped) break;
                    accumulator.collect(handler());
                }
                return accumulator.stopped;
            },
            hide: () => void (this.visible = false),
            destroy: () => void (this.visible = false),
        });
    }
}

const win = (w: object) => w as FakeWindow;

const subject: WindowSubject = {
    name: 'core (fake window)',
    isOracle: false,
    capabilities: { maximizable: true, observesFocus: true, hideOnClose: true },
    create: ({ hideOnClose }) => Object.assign(new FakeWindow(), { hideOnClose: hideOnClose ?? false }),
    show(w) {
        win(w).realized = true;
        win(w).visible = true;
    },
    connect(w, signal, handler) {
        const list = win(w).handlers.get(signal) ?? [];
        list.push(handler);
        win(w).handlers.set(signal, list);
        return list.length;
    },
    close: (w) => win(w).close(),
    maximize: (w) => void win(w).state.reportMaximized(true),
    unmaximize: (w) => void win(w).state.reportMaximized(false),
    isMaximized: (w) => win(w).state.maximized,
    isVisible: (w) => win(w).visible,
    focusables: (w) => win(w).widgets,
    setFocus: (w, widget) => void win(w).state.reportFocus(widget),
    getFocus: (w) => win(w).state.focus,
};

export default async () => {
    await driveWindowVectors(subject, { describe, it, expect }, WINDOW_VECTORS);

    await describe('WindowMemberState', async () => {
        await it('notifies is-active only when the value moves', async () => {
            const seen: string[] = [];
            const state = new WindowMemberState<object>((p) => void seen.push(p));
            expect(state.reportActive(true)).toBe(true);
            expect(state.reportActive(true)).toBe(false);
            expect(state.reportActive(false)).toBe(true);
            expect(JSON.stringify(seen)).toBe('["is-active","is-active"]');
        });
        await it('starts inactive, unmaximized and unfocused, or maximized when told', async () => {
            const plain = new WindowMemberState<object>(() => {});
            expect(JSON.stringify([plain.active, plain.maximized, plain.focus])).toBe('[false,false,null]');
            expect(new WindowMemberState<object>(() => {}, { maximized: true }).maximized).toBe(true);
        });
    });

    await describe('CloseRequestState outcomes', async () => {
        const steps = (over: Partial<Parameters<CloseRequestState['close']>[0]> = {}) => ({
            realized: true,
            hideOnClose: false,
            emit: () => false,
            hide() {},
            destroy() {},
            ...over,
        });
        await it('destroys when nothing stops it, hides under hide-on-close, keeps when handled', async () => {
            const state = new CloseRequestState();
            expect(state.close(steps())).toBe('destroyed');
            expect(state.close(steps({ hideOnClose: true }))).toBe('hidden');
            expect(state.close(steps({ emit: () => true }))).toBe('handled');
            expect(state.close(steps({ realized: false }))).toBe('ignored');
        });
        await it('a throwing handler leaves the window open and the guard released', async () => {
            const state = new CloseRequestState();
            let destroyed = 0;
            expect(() =>
                state.close(
                    steps({
                        emit() {
                            throw new Error('boom');
                        },
                        destroy: () => void destroyed++,
                    }),
                ),
            ).toThrow('boom');
            expect(JSON.stringify([destroyed, state.emitting])).toBe('[0,false]');
        });
        await it('HandledAccumulator treats undefined and false as not handled', async () => {
            const acc = new HandledAccumulator();
            acc.collect(undefined);
            acc.collect(false);
            expect(acc.stopped).toBe(false);
            acc.collect(1);
            expect(acc.stopped).toBe(true);
        });
    });
};

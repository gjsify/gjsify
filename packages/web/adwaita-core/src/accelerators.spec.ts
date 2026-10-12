// Accelerator parsing, bookkeeping and dispatch (ADR 0098 § 1). The expected strings are what
// `gtk_accelerator_parse` / `gtk_accelerator_name` and `Gtk.Application` answered on GTK 4.22.

import { describe, expect, it } from '@gjsify/unit';

import { AcceleratorMap, ModifierMask, acceleratorName, parseAcceleratorKeyval } from './accelerators.js';
import { GtkApplicationBase, dispatchAccelerator, type ApplicationHost } from './application.js';
import { SimpleAction, installActionMap } from './gio-actions.js';

const host: ApplicationHost = {
    name: 'test host',
    requiresWindow: false,
    start: (body) => void body(),
    detach() {},
    exit() {},
};

class TestApplication extends GtkApplicationBase {
    static override host = host;
}

class FakeWindow {}
installActionMap(FakeWindow.prototype);

const noParent = (): undefined => undefined;
const CONTROL = ModifierMask.CONTROL;
const SHIFT = ModifierMask.SHIFT;

export default async () => {
    await describe('accelerators: parse and name (ADR 0098 § 1)', async () => {
        await it('parses <Primary>, <Ctrl> and <Control> as Control', () => {
            expect(parseAcceleratorKeyval('<Primary>q')).toStrictEqual({ keyval: 0x71, modifiers: CONTROL });
            expect(parseAcceleratorKeyval('<Ctrl>q')).toStrictEqual({ keyval: 0x71, modifiers: CONTROL });
            expect(parseAcceleratorKeyval('<Control>q')).toStrictEqual({ keyval: 0x71, modifiers: CONTROL });
        });

        await it('lowercases the key and combines modifiers', () => {
            expect(parseAcceleratorKeyval('<Ctrl><Shift>S')).toStrictEqual({ keyval: 0x73, modifiers: 5 });
        });

        await it('knows Alt, Super and Meta by their GDK bits', () => {
            expect(parseAcceleratorKeyval('<Alt>a')?.modifiers).toBe(8);
            expect(parseAcceleratorKeyval('<Super>a')?.modifiers).toBe(1 << 26);
            expect(parseAcceleratorKeyval('<Meta>a')?.modifiers).toBe(1 << 28);
        });

        await it('returns null for an unknown modifier, <Release> and an unterminated <', () => {
            expect(parseAcceleratorKeyval('<bogus>a')).toBe(null);
            expect(parseAcceleratorKeyval('<Release>a')).toBe(null);
            expect(parseAcceleratorKeyval('<Control')).toBe(null);
        });

        await it('accepts an empty string and a bare modifier with key 0', () => {
            expect(parseAcceleratorKeyval('')).toStrictEqual({ keyval: 0, modifiers: 0 });
            expect(parseAcceleratorKeyval('<Control>')).toStrictEqual({ keyval: 0, modifiers: CONTROL });
        });

        await it('resolves keysym names', () => {
            expect(parseAcceleratorKeyval('plus')?.keyval).toBe(0x2b);
            expect(parseAcceleratorKeyval('Return')?.keyval).toBe(0xff0d);
            expect(parseAcceleratorKeyval('Page_Up')?.keyval).toBe(0xff55);
            expect(parseAcceleratorKeyval('F4')?.keyval).toBe(0xffbe + 3);
        });

        await it('refuses a key name outside the subset, naming it', () => {
            let message = '';
            try {
                parseAcceleratorKeyval('<Control>NoSuchKeysym');
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('NoSuchKeysym')).toBe(true);
        });

        await it('names modifiers in gtk_accelerator_name order', () => {
            expect(acceleratorName({ keyval: 0x73, modifiers: 5 })).toBe('<Shift><Control>s');
            expect(acceleratorName({ keyval: 0x2b, modifiers: CONTROL })).toBe('<Control>plus');
            expect(acceleratorName({ keyval: 0xff0d, modifiers: 0 })).toBe('Return');
        });
    });

    await describe('accelerators: AcceleratorMap bookkeeping', async () => {
        await it('stores normalized names and shares one entry across detailed spellings', () => {
            const map = new AcceleratorMap();
            map.setAccels('app.a', ['<Primary>q', '<Ctrl><Shift>S']);
            map.setAccels('app.foo::bar', ['<Primary>b']);
            expect(map.getAccels('app.a')).toStrictEqual(['<Control>q', '<Shift><Control>s']);
            expect(map.getAccels("app.foo('bar')")).toStrictEqual(['<Control>b']);
            expect(map.getAccels('app.unknown')).toStrictEqual([]);
        });

        await it('removes an entry with an empty list and keeps insertion order', () => {
            const map = new AcceleratorMap();
            map.setAccels('app.one', ['<Primary>1']);
            map.setAccels('app.two', ['<Primary>2']);
            map.setAccels('app.three', ['<Primary>3']);
            map.setAccels('app.two', []);
            expect(map.listActions()).toStrictEqual(['app.one', 'app.three']);
        });

        await it('keeps the previous value when an accelerator does not parse', () => {
            const map = new AcceleratorMap();
            map.setAccels('app.x', ['<Primary>x']);
            const original = console.error;
            console.error = () => {};
            try {
                map.setAccels('app.x', ['<bogus>a']);
            } finally {
                console.error = original;
            }
            expect(map.getAccels('app.x')).toStrictEqual(['<Control>x']);
        });

        await it('keeps duplicates within a call and lets actions share an accelerator', () => {
            const map = new AcceleratorMap();
            map.setAccels('app.s', ['<Primary>s', '<Primary>s']);
            map.setAccels('app.t', ['<Primary>s']);
            expect(map.getAccels('app.s')).toStrictEqual(['<Control>s', '<Control>s']);
            expect(map.actionsFor('<Control>s')).toStrictEqual(['app.s', 'app.t']);
            expect(map.actionsFor('<Control>z')).toStrictEqual([]);
        });
    });

    await describe('accelerators: Gtk.Application dispatch', async () => {
        const setup = () => {
            const app = new TestApplication({ application_id: 'org.gjsify.vec.Accel' });
            const window = new FakeWindow();
            app.add_window(window);
            const hits: unknown[] = [];
            const add = (owner: object, name: string, enabled = true) => {
                const action = new SimpleAction({ name, enabled });
                action.connect('activate', (_a: unknown, parameter: unknown) => hits.push([name, parameter ?? null]));
                (owner as { add_action(a: object): void }).add_action(action);
                return action;
            };
            return { app, window, hits, add };
        };

        await it('activates app. and win. actions on their key press', () => {
            const { app, window, hits, add } = setup();
            add(app, 'save');
            add(window, 'open');
            app.set_accels_for_action('app.save', ['<Primary>s']);
            app.set_accels_for_action('win.open', ['<Primary>o']);
            expect(dispatchAccelerator(window, { key: 's', state: CONTROL, pressed: true }, noParent)).toBe(true);
            expect(dispatchAccelerator(window, { key: 'o', state: CONTROL, pressed: true }, noParent)).toBe(true);
            expect(hits.map((hit) => (hit as string[])[0])).toStrictEqual(['save', 'open']);
        });

        await it('matches Ctrl+Shift+S by modifiers, case-insensitively', () => {
            const { app, window, hits, add } = setup();
            add(app, 'save-as');
            app.set_accels_for_action('app.save-as', ['<Primary><Shift>s']);
            expect(dispatchAccelerator(window, { key: 'S', state: CONTROL | SHIFT, pressed: true }, noParent)).toBe(
                true,
            );
            expect(dispatchAccelerator(window, { key: 's', state: CONTROL, pressed: true }, noParent)).toBe(false);
            expect(hits.length).toBe(1);
        });

        await it('ignores key releases, disabled actions and unknown actions', () => {
            const { app, window, hits, add } = setup();
            add(app, 'off', false);
            app.set_accels_for_action('app.off', ['<Primary>d']);
            app.set_accels_for_action('app.missing', ['<Primary>m']);
            expect(dispatchAccelerator(window, { key: 'd', state: CONTROL, pressed: true }, noParent)).toBe(false);
            expect(dispatchAccelerator(window, { key: 'm', state: CONTROL, pressed: true }, noParent)).toBe(false);
            add(app, 'on');
            app.set_accels_for_action('app.on', ['<Primary>k']);
            expect(dispatchAccelerator(window, { key: 'k', state: CONTROL, pressed: false }, noParent)).toBe(false);
            expect(hits.length).toBe(0);
        });

        await it('passes the target of the detailed name', () => {
            const { app, window, hits, add } = setup();
            add(app, 'view');
            app.set_accels_for_action('app.view::list', ['<Primary>l']);
            dispatchAccelerator(window, { key: 'l', state: CONTROL, pressed: true }, noParent);
            expect(hits).toStrictEqual([['view', 'list']]);
        });

        await it('does nothing for a window without an application', () => {
            const window = new FakeWindow();
            expect(dispatchAccelerator(window, { key: 's', state: CONTROL, pressed: true }, noParent)).toBe(false);
        });
    });
};

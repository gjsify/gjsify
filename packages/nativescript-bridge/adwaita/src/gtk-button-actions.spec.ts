// `Gtk.Button` as a `Gtk.Actionable` and an icon-only control, against the platform double:
// the tree and the state, never pixels (no layout pass, no CSS engine).

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import { applyNativeTooltip } from './widgets/native-tooltip.js';
import { SimpleAction, SimpleActionGroup, insertActionGroup } from './widgets/actions.js';
import * as Gtk from './namespace/gtk.js';

const tap = (button: object): void => (button as Gtk.Button).notify({ eventName: 'tap', object: button as never });

const groupWith = (name: string, run: () => void, enabled = true): SimpleActionGroup => {
    const group = new SimpleActionGroup();
    const action = new SimpleAction({ name, enabled });
    action.connect('activate', run);
    group.add_action(action);
    return group;
};

export const GtkButtonActionsNsTest = async () => {
    await describe('Gtk.Button: action-name dispatch', async () => {
        await it('a tap activates the action found on an ancestor, and still emits clicked', () => {
            const box = new Gtk.Box();
            const button = new Gtk.Button({ iconName: 'move-to-window-symbolic' });
            button.actionName = 'source-view.copy';
            box.append(button as unknown as never);
            let ran = 0;
            let clicked = 0;
            insertActionGroup(
                box as never,
                'source-view',
                groupWith('copy', () => ran++),
            );
            button.connect('clicked', () => clicked++);
            tap(button);
            expect(ran).toBe(1);
            expect(clicked).toBe(1);
        });

        await it('a dangling or disabled action name is a quiet no-op, clicked still fires', () => {
            const button = new Gtk.Button();
            let clicked = 0;
            button.connect('clicked', () => clicked++);
            button.actionName = 'win.missing';
            tap(button);
            let ran = 0;
            insertActionGroup(
                button as never,
                'win',
                groupWith('off', () => ran++, false),
            );
            button.actionName = 'win.off';
            tap(button);
            expect(ran).toBe(0);
            expect(clicked).toBe(2);
        });

        await it('an action name written from a .blp (action-name) dispatches the same way', () => {
            const button = build({ tag: 'GtkButton', props: { 'action-name': 'win.go' } }) as unknown as Gtk.Button;
            let ran = 0;
            insertActionGroup(
                button as never,
                'win',
                groupWith('go', () => ran++),
            );
            tap(button);
            expect(ran).toBe(1);
        });
    });

    await describe('Gtk.Button: icon-only and tooltip', async () => {
        await it('an icon-only button wears image-button, a labelled one does not', () => {
            const button = new Gtk.Button({ iconName: 'move-to-window-symbolic' });
            button.styleClasses = 'osd';
            expect(button.className).toBe('adw-button osd image-button');
            expect(button.styleClasses).toStrictEqual(['osd']);
            button.label = 'Copy';
            expect(button.className).toBe('adw-button osd');
            button.iconName = 'list-add-symbolic';
            expect(button.className).toBe('adw-button osd image-button');
        });

        await it('an osd icon button pins its glyph white, in either order of writes', () => {
            const a = new Gtk.Button({ iconName: 'list-add-symbolic' });
            a.styleClasses = 'osd';
            const b = new Gtk.Button();
            b.styleClasses = 'osd';
            b.iconName = 'list-add-symbolic';
            for (const button of [a, b]) {
                expect((button as unknown as { _content: { iconColor: string } })._content.iconColor).toBe('#ffffff');
            }
        });

        await it('tooltip-text reaches the native view once it exists, and is cleared with empty', () => {
            const calls: Array<string | null> = [];
            const button = new Gtk.Button();
            (button as unknown as { nativeViewProtected: unknown }).nativeViewProtected = {
                setTooltipText: (text: string | null) => calls.push(text),
            };
            button.tooltipText = 'Copy to editor';
            expect(button.accessibilityHint).toBe('Copy to editor');
            button.tooltipText = '';
            expect(calls).toStrictEqual(['Copy to editor', null]);
        });

        await it('below API 26 the native tooltip is never touched', () => {
            const calls: Array<string | null> = [];
            const native = { setTooltipText: (text: string | null) => calls.push(text) };
            applyNativeTooltip({ nativeViewProtected: native }, 'x', 24);
            expect(calls).toStrictEqual([]);
            applyNativeTooltip({ nativeViewProtected: native }, 'x', 26);
            expect(calls).toStrictEqual(['x']);
        });

        await it('a native view without setTooltipText (iOS, double) is left alone', () => {
            const button = new Gtk.Button();
            (button as unknown as { nativeViewProtected: unknown }).nativeViewProtected = {};
            button.tooltipText = 'x';
            expect(button.tooltipText).toBe('x');
        });
    });

    await describe('an icon button on a dark container', async () => {
        await it('an icon button mounted under an osd box gets a white glyph', () => {
            // `toolbar.osd` is one dark bar; the glyph is rasterised, so only the button can pin it,
            // and the button learns of the bar only once the tree is mounted.
            const bar = new Gtk.Box();
            bar.styleClasses = 'toolbar osd';
            const button = new Gtk.Button({ iconName: 'play-symbolic' });
            bar.append(button as unknown as never);
            button.notify({ eventName: 'loaded', object: button as never });

            const image = (button as unknown as { getChildAt(index: number): { iconColor: string } }).getChildAt(0);
            expect(image.iconColor).toBe('#ffffff');
        });

        await it('a button outside any osd box keeps the scheme colour', () => {
            const box = new Gtk.Box();
            const button = new Gtk.Button({ iconName: 'play-symbolic' });
            box.append(button as unknown as never);
            button.notify({ eventName: 'loaded', object: button as never });

            const image = (button as unknown as { getChildAt(index: number): { iconColor: string } }).getChildAt(0);
            expect(image.iconColor === '#ffffff').toBe(false);
        });
    });
};

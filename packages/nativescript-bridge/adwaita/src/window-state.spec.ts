// `Adw.Window` / `Adw.Dialog` — the pure half: the size properties, the presentation modes, and
// the walk that finds the window a dialog is presented in.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_DIALOG_PRESENTATION_MODES,
    dialogPresentationMode,
    findDialogHost,
    surfaceSize,
} from './widgets/window-state.js';

/** A node of a fake view tree, optionally a dialog host. */
interface Node {
    parent: Node | null;
    _hostDialog?: (dialog: unknown) => void;
    _unhostDialog?: (dialog: unknown) => void;
}

const node = (parent: Node | null, host = false): Node => ({
    parent,
    ...(host ? { _hostDialog: () => {}, _unhostDialog: () => {} } : {}),
});

export default async () => {
    await describe('surfaceSize', async () => {
        await it('takes an integer from -1 up', () => {
            expect(surfaceSize(800, 800, 0, 'defaultWidth')).toBe(800);
            expect(surfaceSize(600, '600', 0, 'defaultHeight')).toBe(600);
            expect(surfaceSize(-1, -1, 0, 'contentWidth')).toBe(-1);
            expect(surfaceSize(0, 0, 5, 'defaultWidth')).toBe(0);
        });

        await it('keeps the current value for a blank attribute', () => {
            expect(surfaceSize(Number.NaN, '', 360, 'defaultWidth')).toBe(360);
            expect(surfaceSize(Number.NaN, '  ', 360, 'defaultWidth')).toBe(360);
        });

        await it('refuses a value that is no size, naming what was written and the property', () => {
            expect(() => surfaceSize(-2, -2, 0, 'defaultWidth')).toThrow("'-2' is not a size: 'defaultWidth'");
            expect(() => surfaceSize(1.5, 1.5, 0, 'contentWidth')).toThrow('is not a size');
            expect(() => surfaceSize(Number.NaN, 'wide', 0, 'contentHeight')).toThrow("'wide' is not a size");
        });
    });

    await describe('Adw.DialogPresentationMode', async () => {
        await it('has the three members in constant order, and takes a nick or the constant', () => {
            expect([...ADW_DIALOG_PRESENTATION_MODES]).toStrictEqual(['auto', 'floating', 'bottom-sheet']);
            expect(dialogPresentationMode('floating')).toBe('floating');
            expect(dialogPresentationMode('bottom_sheet')).toBe('bottom-sheet');
            expect(dialogPresentationMode(2)).toBe('bottom-sheet');
        });

        await it('refuses a word that is not a member, naming them', () => {
            expect(() => dialogPresentationMode('window')).toThrow('is not a Adw.DialogPresentationMode');
        });
    });

    await describe('findDialogHost — the window a dialog is presented in', async () => {
        await it('is the parent itself when it hosts dialogs', () => {
            const window = node(null, true);
            expect(findDialogHost(window) === (window as unknown)).toBe(true);
        });

        await it('is the nearest ancestor that hosts dialogs, however deep the parent sits', () => {
            const window = node(null, true);
            const deep = node(node(node(window)));
            expect(findDialogHost(deep) === (window as unknown)).toBe(true);
        });

        await it('prefers the NEAREST host when two nest', () => {
            const outer = node(null, true);
            const inner = node(node(outer), true);
            expect(findDialogHost(node(inner)) === (inner as unknown)).toBe(true);
        });

        await it('is null with no host above, and for no parent at all', () => {
            expect(findDialogHost(node(node(null)))).toBe(null);
            expect(findDialogHost(null)).toBe(null);
            expect(findDialogHost(undefined)).toBe(null);
        });

        await it('does not take a node with only one of the two host methods', () => {
            const half: Node = { parent: null, _hostDialog: () => {} };
            expect(findDialogHost(half)).toBe(null);
        });

        await it('terminates on a parent cycle instead of hanging', () => {
            const a = node(null);
            const b = node(a);
            a.parent = b;
            expect(findDialogHost(a)).toBe(null);
        });
    });
};

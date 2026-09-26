import { describe, expect, it } from '@gjsify/unit';

import { formatAcceleratorLabel, formatManifestShortcut } from './shortcut-format.js';

export default async () => {
    await describe('formatManifestShortcut on mac', async () => {
        await it('renders Alt+Shift as Option+Shift glyphs, no separator', () => {
            expect(formatManifestShortcut('Alt+Shift+B', 'mac')).toBe('⌥⇧B');
        });

        await it('renders MacCtrl as the actual Control glyph', () => {
            expect(formatManifestShortcut('MacCtrl+Shift+B', 'mac')).toBe('⌃⇧B');
        });

        await it("renders Command, and Ctrl (Chrome's mac alias for it), as ⌘", () => {
            expect(formatManifestShortcut('Command+Shift+B', 'mac')).toBe('⇧⌘B');
            expect(formatManifestShortcut('Ctrl+Shift+B', 'mac')).toBe('⇧⌘B');
        });

        await it("orders modifiers Apple's way regardless of input order", () => {
            expect(formatManifestShortcut('Shift+Command+Alt+MacCtrl+B', 'mac')).toBe('⌃⌥⇧⌘B');
        });

        await it('passes through a value an engine already rendered as glyphs', () => {
            expect(formatManifestShortcut('⌥⇧B', 'mac')).toBe('⌥⇧B');
        });

        await it('keeps an unrecognised modifier word out of the glyph set', () => {
            expect(formatManifestShortcut('Fn+B', 'mac')).toBe('B');
        });

        await it('renders the small table of special keys', () => {
            expect(formatManifestShortcut('Ctrl+Return', 'mac')).toBe('⌘↩');
            expect(formatManifestShortcut('Escape', 'mac')).toBe('⎋');
            expect(formatManifestShortcut('Ctrl+Delete', 'mac')).toBe('⌘⌫');
            expect(formatManifestShortcut('Ctrl+Tab', 'mac')).toBe('⌘⇥');
            expect(formatManifestShortcut('Ctrl+Up', 'mac')).toBe('⌘↑');
            expect(formatManifestShortcut('Ctrl+Down', 'mac')).toBe('⌘↓');
            expect(formatManifestShortcut('Ctrl+Left', 'mac')).toBe('⌘←');
            expect(formatManifestShortcut('Ctrl+Right', 'mac')).toBe('⌘→');
            expect(formatManifestShortcut('Ctrl+Space', 'mac')).toBe('⌘Space');
        });

        await it('leaves an unlisted key name as-is', () => {
            expect(formatManifestShortcut('Ctrl+F1', 'mac')).toBe('⌘F1');
        });
    });

    await describe('formatManifestShortcut off mac', async () => {
        await it("leaves the browser's own spelling alone", () => {
            expect(formatManifestShortcut('Alt+Shift+B', 'other')).toBe('Alt+Shift+B');
        });

        await it('still passes through pre-rendered glyphs', () => {
            expect(formatManifestShortcut('⌥⇧B', 'other')).toBe('⌥⇧B');
        });
    });

    await describe('formatManifestShortcut with no binding', async () => {
        await it('stays empty on every platform', () => {
            expect(formatManifestShortcut('', 'mac')).toBe('');
            expect(formatManifestShortcut('   ', 'mac')).toBe('');
            expect(formatManifestShortcut('', 'other')).toBe('');
        });
    });

    await describe('formatAcceleratorLabel', async () => {
        await it('renders a GTK-style human label off mac', () => {
            expect(formatAcceleratorLabel('<Control><Shift>b', 'other')).toBe('Ctrl+Shift+B');
            expect(formatAcceleratorLabel('<Primary>q', 'other')).toBe('Ctrl+Q');
            expect(formatAcceleratorLabel('<Alt>F4', 'other')).toBe('Alt+F4');
        });

        await it('renders Apple glyphs on mac, no separator', () => {
            expect(formatAcceleratorLabel('<Control><Shift>b', 'mac')).toBe('⌃⇧B');
            expect(formatAcceleratorLabel('<Alt>F4', 'mac')).toBe('⌥F4');
        });

        await it("resolves <Primary> to ⌘ on mac — GTK's own macOS behaviour", () => {
            expect(formatAcceleratorLabel('<Primary>q', 'mac')).toBe('⌘Q');
        });

        await it('keeps <Control> as the real Control glyph on mac', () => {
            expect(formatAcceleratorLabel('<Control>q', 'mac')).toBe('⌃Q');
        });

        await it('returns the input unchanged when it fails to parse', () => {
            expect(formatAcceleratorLabel('<Frobnicate>a', 'mac')).toBe('<Frobnicate>a');
            expect(formatAcceleratorLabel('<Control', 'other')).toBe('<Control');
        });
    });
};

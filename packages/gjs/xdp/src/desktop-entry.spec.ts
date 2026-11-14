import { describe, expect, it } from '@gjsify/unit';

import {
    autostartFileName,
    desktopFileText,
    escapeString,
    execLine,
    isOwnedFile,
    OWNER_MARKER_KEY,
    quoteExecArg,
} from './desktop-entry.js';

export default async () => {
    await describe('quoteExecArg', async () => {
        await it('leaves a plain word alone', async () => {
            expect(quoteExecArg('my-app')).toBe('my-app');
        });
        await it('doubles a literal percent', async () => {
            expect(quoteExecArg('100%')).toBe('100%%');
        });
        await it('quotes an argument with a space', async () => {
            expect(quoteExecArg('/opt/My App/run')).toBe('"/opt/My App/run"');
        });
        await it('quotes the empty argument', async () => {
            expect(quoteExecArg('')).toBe('""');
        });
        await it('escapes a dollar inside quotes and then doubles the backslash', async () => {
            expect(quoteExecArg('a $b')).toBe('"a \\\\$b"');
        });
        await it('rejects a newline', async () => {
            expect(() => quoteExecArg('a\nb')).toThrow();
        });
    });
    await describe('execLine', async () => {
        await it('joins quoted arguments with spaces', async () => {
            expect(execLine(['/usr/bin/app', '--name', 'two words'])).toBe('/usr/bin/app --name "two words"');
        });
        await it('refuses an empty command line', async () => {
            expect(() => execLine([])).toThrow();
        });
    });
    await describe('escapeString', async () => {
        await it('escapes backslash and newline', async () => {
            expect(escapeString('a\\b\nc')).toBe('a\\\\b\\nc');
        });
    });
    await describe('desktopFileText and isOwnedFile', async () => {
        const text = desktopFileText({ name: 'My App', commandline: ['/usr/bin/app'] });
        await it('carries the marker and the Exec line', async () => {
            expect(text.includes(`${OWNER_MARKER_KEY}=true`)).toBe(true);
            expect(text.includes('Exec=/usr/bin/app\n')).toBe(true);
        });
        await it('recognises its own output', async () => {
            expect(isOwnedFile(text)).toBe(true);
        });
        await it('does not recognise a file without the marker', async () => {
            expect(isOwnedFile('[Desktop Entry]\nName=x\nExec=y\n')).toBe(false);
        });
        await it('does not accept the marker in another group', async () => {
            expect(isOwnedFile(`[Desktop Entry]\nName=x\n[Other]\n${OWNER_MARKER_KEY}=true\n`)).toBe(false);
        });
    });
    await describe('autostartFileName', async () => {
        await it('appends .desktop', async () => {
            expect(autostartFileName('org.example.App')).toBe('org.example.App.desktop');
        });
        await it('rejects a path and a parent reference', async () => {
            expect(() => autostartFileName('../evil')).toThrow();
            expect(() => autostartFileName('a/b')).toThrow();
            expect(() => autostartFileName('a..b')).toThrow();
            expect(() => autostartFileName('')).toThrow();
        });
    });
};

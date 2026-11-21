// SPDX-License-Identifier: MIT
// The `Exec=` line of the desktop entry: command, `desktopExecArgs`, field code.

import { describe, expect, it } from '@gjsify/unit';

import { type AppMetadataInputs, renderDesktopEntry, renderMetainfoApp } from './app-metadata.js';

function inputs(overrides: Partial<AppMetadataInputs> = {}): AppMetadataInputs {
    return {
        appId: 'org.example.Hello',
        name: 'Hello',
        command: 'hello',
        kind: 'app',
        metadata: { summary: 'Says hello' },
        configKey: 'gjsify.ship',
        ...overrides,
    };
}

function execLine(overrides: Partial<AppMetadataInputs> = {}): string {
    const line = renderDesktopEntry(inputs(overrides))
        .split('\n')
        .find((l) => l.startsWith('Exec='));
    return line as string;
}

export default async () => {
    await describe('renderDesktopEntry Exec=', async () => {
        await it('is the bare command without desktopExecArgs', async () => {
            expect(execLine()).toBe('Exec=hello');
        });

        await it('places plain args after the command', async () => {
            expect(execLine({ desktopExecArgs: ['window', '--new'] })).toBe('Exec=hello window --new');
        });

        await it('puts the args before the MIME field code', async () => {
            const metadata = { summary: 'x', provides: { mimetypes: ['application/x-hello'] } };
            expect(execLine({ desktopExecArgs: ['window'], metadata })).toBe('Exec=hello window %f');
            const scheme = { summary: 'x', provides: { mimetypes: ['x-scheme-handler/hello'] } };
            expect(execLine({ desktopExecArgs: ['window'], metadata: scheme })).toBe('Exec=hello window %u');
        });

        await it('quotes an argument with a space and doubles %', async () => {
            expect(execLine({ desktopExecArgs: ['two words'] })).toBe('Exec=hello "two words"');
            expect(execLine({ desktopExecArgs: ['100%'] })).toBe('Exec=hello 100%%');
            expect(execLine({ desktopExecArgs: ['a b%'] })).toBe('Exec=hello "a b%%"');
        });

        await it('escapes quote, dollar and backslash for both spec layers', async () => {
            expect(execLine({ desktopExecArgs: ['say "hi"'] })).toBe('Exec=hello "say \\\\"hi\\\\""');
            expect(execLine({ desktopExecArgs: ['$HOME'] })).toBe('Exec=hello "\\\\$HOME"');
        });

        await it('rejects a newline, naming the config key', async () => {
            expect(() => renderDesktopEntry(inputs({ desktopExecArgs: ['a\nb'] }))).toThrow(
                'gjsify.ship.desktopExecArgs',
            );
        });
    });
    await describe('renderMetainfoApp screenshot environment', async () => {
        await it('keeps the :dark / :light variants AppStream defines', async () => {
            const xml = renderMetainfoApp(
                inputs({
                    metadata: {
                        summary: 'Says hello',
                        screenshots: [
                            { url: 'https://example.org/a.png', environment: 'gnome:dark' },
                            { url: 'https://example.org/b.png', environment: 'plasma:light' },
                            { url: 'https://example.org/c.png', environment: 'cli' },
                        ],
                    },
                }),
            );
            expect(xml).toContain('<screenshot type="default" environment="gnome:dark">');
            expect(xml).toContain('environment="plasma:light"');
            expect(xml).toContain('environment="cli"');
        });
    });
};

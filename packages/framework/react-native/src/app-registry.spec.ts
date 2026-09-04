// The entry point's contract with the application shell it runs on (#1455, ADR 0043).
//
// WHY A KEY-SET ASSERTION AND NOT A LIST OF OPTIONS. The defect this file holds
// against was a forwarding LIST: `runApplication` handed `runAdwaitaApp` an object
// literal naming `applicationId` and `css`, which reads as complete at the call site
// and silently dropped every other field of `AdwaitaAppOptions` — including
// `devtools`, the option that decides whether a running application can be driven,
// inspected or screenshotted from outside at all, and `devtools.address`, the only
// route on a host with no session bus (macOS, Windows).
//
// A spec naming the options it cares about would have gone green on the same shape,
// one option later: the field nobody thought to add is the failure. So the assertion
// is that NOTHING is dropped, whatever it is — which fails for any field list, and
// keeps holding when the shell gains an option nobody has written down here.
//
// `toShellOptions` is pure, so this runs on Node and GJS alike: the shell's options
// are a value, and constructing that value needs no display, no bus and no GTK.

import { describe, expect, it } from '@gjsify/unit';

import { toShellOptions, type RunApplicationOptions } from './app-registry.js';

/** A stand-in for the window factory: identity is all this file reads off it. */
const CREATE_WINDOW = (() => null) as unknown as Parameters<typeof toShellOptions>[1];
const OTHER_WINDOW = (() => null) as unknown as Parameters<typeof toShellOptions>[1];

/**
 * One option of every shell field plus this layer's own, so the key-set assertion
 * has something to lose. The values are irrelevant — only the KEYS are read — which
 * is why an unknown extra key is in here too: a consumer of a NEWER
 * `@gjsify/adwaita-app` than this file knows about must not have their option eaten.
 */
const OPTIONS = {
    applicationId: 'org.example.App',
    title: 'Example',
    defaultWidth: 640,
    defaultHeight: 480,
    initialProps: { greeting: 'hello' },
    css: 'window { background: red; }',
    devtools: true,
    about: { applicationName: 'Example' },
    quitAction: false,
    flags: 0,
    onStartup: () => {},
    anOptionThisFileHasNeverHeardOf: 1,
} as unknown as RunApplicationOptions;

export default async () => {
    await describe('AppRegistry — the shell options', async () => {
        await it('forwards every option it was given, plus createWindow', async () => {
            const shell = toShellOptions(OPTIONS, CREATE_WINDOW);
            const expected = [...Object.keys(OPTIONS), 'createWindow'].sort();
            expect(Object.keys(shell).sort()).toStrictEqual(expected);
        });

        await it('forwards the option VALUES unchanged', async () => {
            const shell = toShellOptions(OPTIONS, CREATE_WINDOW) as unknown as Record<string, unknown>;
            const source = OPTIONS as unknown as Record<string, unknown>;
            for (const key of Object.keys(source)) expect(shell[key]).toBe(source[key]);
        });

        await it('answers createWindow itself, so a consumer cannot replace the React root', async () => {
            // Typed through `never`: `createWindow` is `Omit`ted from
            // `RunApplicationOptions` precisely so this cannot be written by
            // accident. It can still be written by a plain JS consumer, and the
            // spread order is what makes that harmless.
            const withOwnWindow = { ...OPTIONS, createWindow: OTHER_WINDOW } as never;
            expect(toShellOptions(withOwnWindow, CREATE_WINDOW).createWindow).toBe(CREATE_WINDOW);
        });

        await it('does not mutate the options it was handed', async () => {
            const before = Object.keys(OPTIONS).length;
            toShellOptions(OPTIONS, CREATE_WINDOW);
            expect(Object.keys(OPTIONS).length).toBe(before);
            expect('createWindow' in OPTIONS).toBeFalsy();
        });
    });
};

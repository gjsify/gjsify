// The text rules of `./markup.ts`, pinned on hand-written trees. Whether the text is what
// each port BUILDS is not asked here: `adwaita-web`'s and `adwaita-nativescript`'s own
// suites load it through their doors and compare it with their builders' trees.

import { describe, expect, it } from '@gjsify/unit';

import type { SharedTreeNode } from './conformance/shared-trees.js';
import { sharedTreeHtml, sharedTreeNativeScriptXml } from './markup.js';

const CLAMP: SharedTreeNode = {
    tag: 'AdwClamp',
    id: 'clamp',
    props: { 'maximum-size': 400, 'tightening-threshold': 300 },
    children: [
        {
            tag: 'GtkLabel',
            id: 'label',
            slot: 'child',
            props: { label: 'Clamped, and centred.', wrap: true },
            styleClasses: ['card'],
        },
    ],
};

const NS = 'http://schemas.nativescript.org/tns.xsd';

export default async () => {
    await describe('sharedTreeHtml', async () => {
        await it('writes the tag, id, attributes, class and slot buildSharedTree would set', async () => {
            expect(sharedTreeHtml(CLAMP)).toBe(
                [
                    '<adw-clamp id="clamp" maximum-size="400" tightening-threshold="300">',
                    '  <gtk-label',
                    '    id="label"',
                    '    label="Clamped, and centred."',
                    '    wrap',
                    '    class="card"',
                    '    slot="child"',
                    '  ></gtk-label>',
                    '</adw-clamp>',
                ].join('\n'),
            );
        });

        await it('writes `false` as no attribute, since the element reads presence', async () => {
            expect(sharedTreeHtml({ tag: 'GtkLabel', props: { wrap: false, selectable: true } })).toBe(
                '<gtk-label selectable></gtk-label>',
            );
        });

        await it('breaks a start tag wider than the line into one attribute per line', async () => {
            const long = 'This sentence is long enough that the start tag cannot stay on one line.';
            expect(sharedTreeHtml({ tag: 'GtkLabel', id: 'label', props: { label: long } })).toBe(
                ['<gtk-label', '  id="label"', `  label="${long}"`, '></gtk-label>'].join('\n'),
            );
        });

        await it('quotes a value holding a double quote with single quotes, and escapes `&`', async () => {
            expect(sharedTreeHtml({ tag: 'GtkLabel', props: { label: 'Salt & "pepper"' } })).toBe(
                `<gtk-label label='Salt &amp; "pepper"'></gtk-label>`,
            );
        });

        await it('escapes the double quote of a value that holds both quotes', async () => {
            expect(sharedTreeHtml({ tag: 'GtkLabel', props: { label: `"It's"` } })).toBe(
                `<gtk-label label="&quot;It's&quot;"></gtk-label>`,
            );
        });

        // `buildSharedTree` writes a margin as inline style beside its attribute, so markup
        // that did not would parse to a tree without the inset.
        await it('writes a margin as inline style too, in the order the props hold them', async () => {
            expect(sharedTreeHtml({ tag: 'GtkBox', props: { 'margin-top': 18, 'margin-start': 12 } })).toBe(
                [
                    '<gtk-box',
                    '  margin-top="18"',
                    '  margin-start="12"',
                    '  style="margin-top: 18px; margin-inline-start: 12px;"',
                    '></gtk-box>',
                ].join('\n'),
            );
        });

        // ADR 0072: what `writeExtensions` writes for each kind.
        await it('writes a string list as its `strings` attribute, a JSON array', async () => {
            const list: SharedTreeNode = {
                tag: 'GtkStringList',
                slot: 'model',
                extensions: { strings: [{ value: 'Blue', translatable: {} }, { value: 'Teal' }] },
            };
            expect(sharedTreeHtml(list)).toBe(
                `<gtk-string-list strings='["Blue","Teal"]' slot="model"></gtk-string-list>`,
            );
        });

        await it('writes each response as an <adw-alert-response> child ahead of the children', async () => {
            const dialog: SharedTreeNode = {
                tag: 'AdwAlertDialog',
                extensions: {
                    responses: [
                        { id: 'cancel', label: 'Cancel' },
                        { id: 'delete', label: 'Delete & close', appearance: 'destructive', enabled: false },
                    ],
                },
            };
            expect(sharedTreeHtml(dialog)).toBe(
                [
                    '<adw-alert-dialog>',
                    '  <adw-alert-response id="cancel">Cancel</adw-alert-response>',
                    '  <adw-alert-response id="delete" appearance="destructive" enabled="false">Delete &amp; close</adw-alert-response>',
                    '</adw-alert-dialog>',
                ].join('\n'),
            );
        });
    });

    await describe('sharedTreeNativeScriptXml', async () => {
        await it('declares one barrel per library and places a slot as a complex property', async () => {
            expect(sharedTreeNativeScriptXml(CLAMP)).toBe(
                [
                    '<adw:Clamp',
                    `  xmlns="${NS}"`,
                    '  xmlns:adw="~/adw"',
                    '  xmlns:gtk="~/gtk"',
                    '  id="clamp"',
                    '  maximumSize="400"',
                    '  tighteningThreshold="300"',
                    '>',
                    '  <adw:Clamp.child>',
                    '    <gtk:Label',
                    '      id="label"',
                    '      label="Clamped, and centred."',
                    '      wrap="true"',
                    '      styleClasses="card"',
                    '    />',
                    '  </adw:Clamp.child>',
                    '</adw:Clamp>',
                ].join('\n'),
            );
        });

        await it('declares only the barrels the tree uses', async () => {
            expect(sharedTreeNativeScriptXml({ tag: 'GtkLabel', props: { label: 'Hi' } })).toBe(
                ['<gtk:Label', `  xmlns="${NS}"`, '  xmlns:gtk="~/gtk"', '  label="Hi"', '/>'].join('\n'),
            );
        });

        await it('quotes a value holding a double quote with single quotes, and escapes `&` and `<`', async () => {
            expect(sharedTreeNativeScriptXml({ tag: 'GtkLabel', props: { label: 'a<b & "c"' } })).toBe(
                ['<gtk:Label', `  xmlns="${NS}"`, '  xmlns:gtk="~/gtk"', `  label='a&lt;b &amp; "c"'`, '/>'].join('\n'),
            );
        });

        await it('refuses a class outside the two barrels', async () => {
            let caught: unknown;
            try {
                sharedTreeNativeScriptXml({ tag: 'ShumateMap' });
            } catch (error) {
                caught = error;
            }
            expect(caught instanceof Error ? caught.message : undefined).toBe(
                'sharedTreeNativeScriptXml: ShumateMap is not an Adw or Gtk class name',
            );
        });
    });
};

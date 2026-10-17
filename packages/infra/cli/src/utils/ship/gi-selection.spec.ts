// SPDX-License-Identifier: MIT
// The gate between what an Android app CONFIGURES and what its bundle IMPORTS.
//
// ADR 0117 § 2: `nativescript.giNamespaces` decides what the APK carries, and the
// scan of the emitted bundle is a LOWER BOUND on what it needs. The two can disagree
// in both directions and only one of them is fatal:
//
//   * imported but not configured — the typelib is not in the APK, so the import
//     throws on the device, after the download, reading like an application bug.
//     That is the failure this file exists to turn into a build error with the
//     namespace in it.
//   * configured but not imported — the APK is bigger than it needs to be. A
//     warning, never a refusal: the scanner is a lower bound (a namespace reached
//     through a computed specifier is invisible to it), so refusing here would make
//     a correct project unbuildable on the scanner's blind spot.

import { describe, expect, it } from '@gjsify/unit';

import { planGiSelection } from './gi-selection.js';

export default async () => {
    await describe('planGiSelection', async () => {
        await it('selects exactly what the config declares', async () => {
            const { selected } = planGiSelection({ declared: ['Gtk', 'Adw'], scanned: ['Gtk'] });
            expect(selected).toStrictEqual(['Adw', 'Gtk']);
        });

        await it('FAILS naming a namespace the bundle imports and the config omits', async () => {
            // The ADR's own example: an app adds `gi://Soup`, nothing in the config
            // mentions it, and without this the APK ships and dies at the first request.
            expect(() => planGiSelection({ declared: ['Gtk'], scanned: ['Gtk', 'Soup'] })).toThrow(/Soup/);
        });

        await it('names every missing namespace at once, so one build tells the whole story', async () => {
            expect(() => planGiSelection({ declared: [], scanned: ['Soup', 'WebKit'] })).toThrow(/Soup, WebKit/);
        });

        await it('points at the config key rather than just reporting a mismatch', async () => {
            expect(() => planGiSelection({ declared: [], scanned: ['Soup'] })).toThrow(/giNamespaces/);
        });

        await it('compares by NAMESPACE, so a pinned declaration covers a bare import', async () => {
            // The config pins the ABI (`Gtk-4.0`); the bundle's specifier may carry no
            // version at all. Comparing the raw strings would fail a correct project.
            const { selected, unscanned } = planGiSelection({ declared: ['Gtk-4.0'], scanned: ['Gtk'] });
            expect(selected).toStrictEqual(['Gtk-4.0']);
            expect(unscanned).toStrictEqual([]);
        });

        await it('compares by NAMESPACE the other way round too', async () => {
            const { unscanned } = planGiSelection({ declared: ['Gtk'], scanned: ['Gtk-4.0'] });
            expect(unscanned).toStrictEqual([]);
        });

        await it('reports a configured namespace the scan did not see, without failing', async () => {
            // Bigger APK than necessary, or a namespace reached in a way the scanner
            // cannot see. Either way the build goes on.
            const { selected, unscanned } = planGiSelection({ declared: ['Gtk', 'Soup'], scanned: ['Gtk'] });
            expect(selected).toStrictEqual(['Gtk', 'Soup']);
            expect(unscanned).toStrictEqual(['Soup']);
        });

        await it('never asks for the core namespaces the runtime already carries', async () => {
            // GLib and friends back `libnode_gi.so` itself, so they are in every AAR
            // without being selected. Demanding them in the config would make the key
            // boilerplate, and every existing project fail.
            const { selected, unscanned } = planGiSelection({
                declared: [],
                scanned: ['GLib-2.0', 'GObject-2.0', 'Gio-2.0', 'GioUnix-2.0', 'GLibUnix-2.0', 'GModule-2.0', 'GIRepository-3.0'],
            });
            expect(selected).toStrictEqual([]);
            expect(unscanned).toStrictEqual([]);
        });

        await it('still selects a core namespace a project chooses to declare', async () => {
            const { selected } = planGiSelection({ declared: ['GLib'], scanned: [] });
            expect(selected).toStrictEqual(['GLib']);
        });

        await it('asks for nothing when neither side names anything', async () => {
            // The default build: no config key, no GI import. This is the case ADR 0110's
            // measured payload belongs to, so it must stay exactly empty.
            expect(planGiSelection({ declared: [], scanned: [] })).toStrictEqual({ selected: [], unscanned: [] });
        });

        await it('deduplicates and sorts, so the same config always plans the same build', async () => {
            const { selected } = planGiSelection({ declared: ['Gtk', 'Adw', 'Gtk'], scanned: [] });
            expect(selected).toStrictEqual(['Adw', 'Gtk']);
        });

        await it('treats a bare and a pinned declaration of one namespace as one selection', async () => {
            // Passing both to the AAR builder would make `planGiRoots` resolve the same
            // namespace twice; harmless there, but the plan should be the honest set.
            const { selected } = planGiSelection({ declared: ['Gtk-4.0', 'Gtk'], scanned: [] });
            expect(selected).toStrictEqual(['Gtk-4.0']);
        });
    });
};

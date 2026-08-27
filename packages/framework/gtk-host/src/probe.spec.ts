// The half of the probe harness that looks at the WINDOW.
//
// Every case here is the same defect wearing a different mask: a tree that was
// asserted, a process that exited 0, no GTK diagnostic — and nothing on screen. The
// vectors are built with the REAL host ops so "blank" means what it means in an
// application, and the raster seam is injected so the logic is measurable without a
// display (see `probe.ts` § the SHOT half for why `capture` is a parameter at all).

import { expect, it, on } from '@gjsify/unit';

import Gtk from 'gi://Gtk?version=4.0';

import { installDiagnosticsGate } from './conformance/index.js';
import { blankReason, checkRendered, shotEvidence, type CaptureWidget, type ProbeCheck } from './probe.js';
import { registerBuiltinWidgets } from './descriptors/index.js';
import { adopt, createElement, insert } from './host.js';
import { gated, GTK_HOSTS } from './testing/gate.mjs';

/** A capture that always succeeds, with a byte count nothing else could produce. */
const PNG: CaptureWidget = () => new Uint8Array(4242);
/** A capture that answers the way `captureWidgetPng` does before realisation. */
const UNREALISED: CaptureWidget = () => null;

/** A `ProbeCheck` plus the failures it recorded — `runHostProbe`'s pair, in the open. */
function recorder(): { check: ProbeCheck; failures: string[] } {
    const failures: string[] = [];
    return { check: (what, ok) => void (ok ? null : failures.push(what)), failures };
}

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, 'shot evidence', async () => {
            await it('reports a container nothing rendered into as blank, and says which of the three it is', async () => {
                // THE DOCUMENTED DEFECT, reduced. A window whose React root refused
                // the tree keeps its container and loses everything under it. The
                // container is a real, sized, rasterisable widget — several KB of
                // valid PNG — and the picture is of nothing.
                const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
                const evidence = shotEvidence(container as unknown as Gtk.Widget, PNG);

                expect(evidence.widgets).toBe(0);
                expect(evidence.bytes).toBe(4242);
                const reason = blankReason(evidence);
                expect(reason).toContain('nothing was rendered into the container');
                // The byte count must NOT be what saves it: a non-empty PNG is not
                // proof, and a version of this that asked `bytes > 0` first would
                // have called the empty window a pass.
                expect(reason).not.toBe(null);
            });

            await it('passes a container that really holds a materialised child', async () => {
                const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
                // The real host ops through `adopt`, not `box.append`: the point is
                // that a tree A RENDERER built is what gets photographed. `adopt` is
                // the one way a foreign widget becomes a host parent — assigning
                // `widget`/`attached` by hand is the shape `insert` refuses by name.
                const root = adopt(container as unknown as Gtk.Widget);
                const child = createElement('GtkLabel', { label: 'rendered' });
                insert(child, root);
                expect(child.attached).toBe(true);

                // `set_size_request` asks; only a presented window ALLOCATES, and
                // nothing here has one. The allocation is therefore supplied, so this
                // case is about the one thing it is about — a container that really
                // holds a renderer-built child is not blank. (The unallocated case has
                // its own vector below, which is what would catch a version of
                // `blankReason` that stopped asking.)
                const evidence = { ...shotEvidence(container as unknown as Gtk.Widget, PNG), width: 120, height: 40 };
                expect(evidence.widgets).toBe(1);
                expect(blankReason(evidence)).toBe(null);
            });

            await it('tells an unallocated tree apart from an absent one', async () => {
                // Both photograph blank, and they are different bugs: this one has
                // the widgets and no space, the one above has the space and no
                // widgets. A message that conflated them would send the reader to
                // the wrong half of the program.
                const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
                container.append(new Gtk.Label({ label: 'present, unallocated' }));
                const evidence = shotEvidence(container as unknown as Gtk.Widget, PNG);

                expect(evidence.widgets).toBe(1);
                expect(evidence.width).toBe(0);
                expect(blankReason(evidence)).toContain('exist and occupy nothing');
            });

            await it('names the capture that answered before the widget was on screen', async () => {
                const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
                container.append(new Gtk.Label({ label: 'present' }));
                container.set_size_request(120, 40);
                // `set_size_request` does not allocate, so force the third arm by
                // measuring a tree that IS sized and a capture that is not ready.
                const evidence = {
                    ...shotEvidence(container as unknown as Gtk.Widget, UNREALISED),
                    width: 120,
                    height: 40,
                };

                expect(evidence.bytes).toBe(0);
                expect(blankReason(evidence)).toContain('no PNG');
            });

            await it('records the reason THROUGH the check, so the failure list carries it', async () => {
                // `checkRendered` is the only thing a showcase calls, so a version
                // that recorded a bare "did not render" would lose the diagnosis
                // exactly where the reader looks for it.
                const { check, failures } = recorder();
                const empty = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
                checkRendered(
                    check,
                    'the Documents screen rendered',
                    shotEvidence(empty as unknown as Gtk.Widget, PNG),
                );

                expect(failures.length).toBe(1);
                expect(failures[0]).toContain('the Documents screen rendered');
                expect(failures[0]).toContain('no children at all');
            });

            await it('records nothing when the tree really rendered', async () => {
                // The control. A rule measured only where it fires has not been
                // measured — the mutation that makes `checkRendered` record on every
                // call has to fail something, and this is what fails.
                const { check, failures } = recorder();
                const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
                container.append(new Gtk.Label({ label: 'rendered' }));
                container.set_size_request(120, 40);
                const evidence = { ...shotEvidence(container as unknown as Gtk.Widget, PNG), width: 120, height: 40 };

                checkRendered(check, 'the control rendered', evidence);
                expect(failures.length).toBe(0);
            });
        });
    });
};

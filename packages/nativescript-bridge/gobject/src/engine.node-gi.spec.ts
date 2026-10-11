// THE REAL-ENGINE LEG (ADR 0105 stage 2): the GOBJECT_VECTORS against the subset itself, with
// its property store and signal bus replaced by real GObject through `@gjsify/node-gi`.
//
// WHAT THIS MEASURES THAT STAGE 0 DID NOT. `adwaita-core/src/gobject.node-gi.spec.ts` drives the
// vectors against node-gi's own `GObject.registerClass` — real GObject as an ORACLE, answering in
// its own voice. It proves the vectors are not GJS-specific. It says nothing about the subset
// still holding them once ITS store is the real thing: that is this file. The subject here is
// `createGObject(door, createRealGioEngine(requireGi))` — the core's refusals, accessors,
// construct order and error messages, over real GTypes, real `notify`, real emissions and real
// `GBinding`.
//
// SO ALL 24 ROWS RUN HERE, including the seven `holds: 'subset'` refusals the oracle leg skips
// (`isOracle: false`): the refusals are the core's and must survive the engine swap — that is the
// one claim an engine could silently break. The four `widget: true` rows run too, because the
// door is the same two-fake-widget door `gobject.spec.ts` uses, not a real Gtk; no display is
// needed and none is consulted.
//
// WHY IT LIVES HERE AND NOT BESIDE THE VECTORS. `@gjsify/adwaita-core` is tier 2 and may not
// depend on this tier-3 package, and the subject needs the engine. ADR 0105 § 7 asks for the
// engine AND the node-gi subject in this package; the stage-0 ORACLE subject stays in the core
// because it needs no engine at all.
//
// THE SUBJECT ITSELF IS SHIPPED, in `./vector-subject.ts`, because stage 4 added a second leg:
// `tests/integration/nativescript-gi/` drives the same door on an Android device. This file is
// the HOST leg of one measurement, not the owner of the door.
//
// WHY `requireGi` IS A PARAMETER: `engine.ts`'s header. The bridge is imported once, in
// `src/test.node-gi.mts`, which `tsconfig.json` excludes.

import { describe, expect, it } from '@gjsify/unit';

import { driveGObjectVectors } from '@gjsify/adwaita-core/conformance';
import { registeredClassOf, type ParamSpec } from '@gjsify/adwaita-core';

import { createRealGioEngine, type RequireGi } from './engine.js';
import { createSubsetSubject } from './vector-subject.js';

export const realGioEngineSuite = (requireGi: RequireGi) => async () => {
    const engine = createRealGioEngine(requireGi);

    await driveGObjectVectors(createSubsetSubject(engine), { describe, expect, it });

    await describe('real-gio engine: the engine itself (ADR 0105 § 2)', async () => {
        await it('names itself in a diagnostic', () => {
            expect(engine.name).toBe('real-gio');
        });

        await it('refuses an instance of a class it never registered', () => {
            class Stranger {}
            expect(() => engine.getValue(new Stranger(), { name: 'x' } as never)).toThrow();
        });

        // The one engine member whose CONTRACT no vector can see: `setValue` returns whether the
        // CORE still owes a notify, and this engine answers false because the write already
        // notified. A vector only counts notifies, and it counts one either way — so a `setValue`
        // that wrongly returned true would pass every row and double-notify in production.
        await it('leaves the notify to its own store: setValue never asks the core for one', () => {
            const { GObject: G } = createSubsetSubject(engine);
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                { GTypeName: 'EngineNotifyOwner', Properties: { code: P.string('code', '', '', F.READWRITE, '') } },
                class extends G.Object {},
            );
            const instance = new K();
            const seen: string[] = [];
            instance.connect('notify::code', () => seen.push('n'));
            const asked = engine.setValue(instance, specOf(K, 'code'), 'x');
            expect([asked, seen.join('')]).toStrictEqual([false, 'n']);
        });
    });
};

/** The ParamSpec of a registered class, as the core finds it — the engine takes specs, not names. */
function specOf(klass: object, name: string): ParamSpec {
    const found = registeredClassOf(klass)?.properties.find((spec) => spec.name === name);
    if (!found) throw new Error(`no '${name}' property on the registered class`);
    return found;
}

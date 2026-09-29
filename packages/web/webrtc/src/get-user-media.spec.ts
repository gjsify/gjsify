// Regression cover for #1513's binding half.
//
// The bug was never a type error — the type error was the symptom CI could see.
// Writing `(el as _GstElementProps).device = id` on an element that does not
// declare `device` does NOT raise under GJS: GObject properties are installed as
// prototype accessors, so an undeclared name lands as a dead JS own-property and
// the constraint is dropped with the process still healthy. So the testable
// symptom is the own-property itself, and that is what this asserts.
//
// Environment-independent on purpose. Where `pipewiresrc` is installed the audio
// chain picks it and the fix binds `target-object`; in `ghcr.io/gjsify/ci-fedora:44` it is
// absent and the chain lands on `audiotestsrc`, which declares neither. Both must
// end with no own-property, so neither environment can pass a broken binding.

import { describe, it, expect } from '@gjsify/unit';

import { Gst, ensureGstInit } from './gst-init.js';
import { getUserMedia } from './get-user-media.js';

/** The names a capture source may spell its device under; see `_DEVICE_PROPS`. */
const DEVICE_PROPS = ['device', 'target_object', 'path'] as const;

/** An own property here means the write bypassed a GObject accessor and did nothing. */
function deadOwnProps(el: Gst.Element): string[] {
    return DEVICE_PROPS.filter((p) => Object.prototype.hasOwnProperty.call(el, p));
}

function sourceOf(stream: Awaited<ReturnType<typeof getUserMedia>>, kind: 'audio' | 'video'): Gst.Element {
    const track = (kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0]) as unknown as
        | { _gstSource: Gst.Element | null }
        | undefined;
    if (!track?._gstSource) throw new Error(`getUserMedia returned no ${kind} source`);
    return track._gstSource;
}

export default async () => {
    await describe('getUserMedia deviceId binding', async () => {
        await it('never leaves a dead own-property on the source', async () => {
            ensureGstInit();
            const stream = await getUserMedia({ audio: { deviceId: 'gjsify-no-such-device' } });

            // `toEqual` here compares with `==` and rejects a foreign empty array,
            // so assert the count rather than the array.
            expect(deadOwnProps(sourceOf(stream, 'audio')).length).toBe(0);
        });

        await it('binds to a declared property when the source has one', async () => {
            ensureGstInit();
            const stream = await getUserMedia({ video: { deviceId: 'gjsify-no-such-device' } });
            const source = sourceOf(stream, 'video');

            // Either the element declares one of the names and the fix bound it, or it
            // declares none and the fix warned instead. Both are correct; a silent
            // own-property is not.
            const bound = DEVICE_PROPS.find((p) => p in source);
            if (bound) expect(source[bound]).toBe('gjsify-no-such-device');
            else expect(deadOwnProps(source).length).toBe(0);
        });

        // Pins the measurement the warn path rests on. If a GStreamer upgrade adds or
        // renames one of these, this fails and the comment above gets corrected —
        // which is the point: the table is the fix's only real assumption.
        await it('the test sources declare neither name, so the fallback cannot be bound', async () => {
            ensureGstInit();
            for (const factory of ['audiotestsrc', 'videotestsrc']) {
                const el = Gst.ElementFactory.make(factory, null);
                expect(el).not.toBeNull();
                expect(DEVICE_PROPS.filter((p) => p in el!).length).toBe(0);
            }
        });
    });
};

// oxlint-disable typescript/no-explicit-any -- /register existence probes: the W3C
// classes (RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, RTCPeerConnectionIceEvent,
// RTCDataChannel, RTCDataChannelEvent, RTCError, RTCErrorEvent, DOMException) are registered onto
// `globalThis` by the side-effect import of `@gjsify/webrtc/register`. The tests assert presence
// via `(globalThis as any).<Ctor>` because the assertions intentionally read through an untyped
// host object — typing each access against lib.dom would mask a missed registration (the spec's
// purpose is to verify the writes happened, not to consume the constructors typed). Same
// file-level disable precedent as `@gjsify/node-globals`' own register-existence spec.
//
// These tests must run AFTER the register subpaths are imported — in `test.mts` the register
// module is imported alongside the spec, so the assertions below run post-registration.

import { describe, it, expect } from '@gjsify/unit';

import '@gjsify/webrtc/register';

export default async () => {
    await describe('@gjsify/webrtc/register', async () => {
        await it('registers RTCPeerConnection', async () => {
            expect(typeof (globalThis as any).RTCPeerConnection).toBe('function');
        });
        await it('registers RTCSessionDescription', async () => {
            expect(typeof (globalThis as any).RTCSessionDescription).toBe('function');
        });
        await it('registers RTCIceCandidate', async () => {
            expect(typeof (globalThis as any).RTCIceCandidate).toBe('function');
        });
        await it('registers RTCPeerConnectionIceEvent', async () => {
            expect(typeof (globalThis as any).RTCPeerConnectionIceEvent).toBe('function');
        });
        await it('registers RTCDataChannel', async () => {
            expect(typeof (globalThis as any).RTCDataChannel).toBe('function');
        });
        await it('registers RTCDataChannelEvent', async () => {
            expect(typeof (globalThis as any).RTCDataChannelEvent).toBe('function');
        });
        await it('registers RTCError', async () => {
            expect(typeof (globalThis as any).RTCError).toBe('function');
        });
        await it('registers RTCErrorEvent', async () => {
            expect(typeof (globalThis as any).RTCErrorEvent).toBe('function');
        });

        await it('RTCError extends DOMException', async () => {
            const err = new (globalThis as any).RTCError({ errorDetail: 'data-channel-failure' }, 'test');
            const DOMExceptionCtor = (globalThis as any).DOMException;
            if (DOMExceptionCtor) {
                expect(err instanceof DOMExceptionCtor).toBeTruthy();
            }
            expect(err.errorDetail).toBe('data-channel-failure');
        });

        await it('RTCPeerConnectionIceEvent is a subclass of Event', async () => {
            const RTCPeerConnectionIceEventCtor = (globalThis as any).RTCPeerConnectionIceEvent;
            const ev = new RTCPeerConnectionIceEventCtor('icecandidate', { candidate: null });
            expect(ev instanceof Event).toBeTruthy();
            expect(ev.candidate).toBeNull();
        });
    });
};

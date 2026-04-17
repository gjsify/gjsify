// WebRTC globals registration tests — verifies the granular /register
// subpaths wire each identifier onto globalThis.
//
// These tests must run AFTER importing the register subpaths — in `test.mts`
// the register module is imported alongside the spec, so the assertions below
// run post-registration.

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

// Helpers for WPT-ported tests.
//
// Ported from: refs/wpt/webrtc/RTCPeerConnection-helper.js (W3C, BSD-3-Clause)
// The originals use browser globals and the testharness.js framework; here
// we bind them to @gjsify/webrtc's named exports so the test can run under
// @gjsify/unit on GJS.

import {
    RTCPeerConnection,
    type RTCDataChannel,
    type RTCDataChannelInit,
    type RTCSessionDescriptionInit,
} from './index.js';

/** Mirror WPT's `createPeerConnectionWithCleanup` — returns a fresh pc. */
export function createPeerConnection(): RTCPeerConnection {
    return new RTCPeerConnection();
}

/**
 * Mirror WPT's `exchangeOfferAnswer(pc1, pc2)` + `exchangeIceCandidates`.
 * Runs the full handshake to completion.
 */
async function exchangeOfferAnswer(
    pc1: RTCPeerConnection,
    pc2: RTCPeerConnection,
): Promise<void> {
    pc1.onicecandidate = (ev) => {
        if (ev.candidate) pc2.addIceCandidate(ev.candidate.toJSON());
    };
    pc2.onicecandidate = (ev) => {
        if (ev.candidate) pc1.addIceCandidate(ev.candidate.toJSON());
    };
    const offer = (await pc1.createOffer()) as RTCSessionDescriptionInit;
    await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription(offer);
    const answer = (await pc2.createAnswer()) as RTCSessionDescriptionInit;
    await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription(answer);
}

/**
 * Port of WPT `createDataChannelPair(t, options, pc1, pc2)` — returns
 * `[dc1, dc2]` both in `'open'` state, handshake complete. If `options.negotiated`
 * both sides pre-create the channel with matching id; otherwise pc1 creates
 * and pc2 receives via `ondatachannel`.
 */
export async function createDataChannelPair(
    options: RTCDataChannelInit = {},
    pc1: RTCPeerConnection = createPeerConnection(),
    pc2: RTCPeerConnection = createPeerConnection(),
    label = 'wpt',
): Promise<[RTCDataChannel, RTCDataChannel, RTCPeerConnection, RTCPeerConnection]> {
    let pair: [RTCDataChannel, RTCDataChannel];
    let bothOpen: Promise<unknown>;

    if (options.negotiated) {
        const dc1 = pc1.createDataChannel(label, options);
        const dc2 = pc2.createDataChannel(label, options);
        pair = [dc1, dc2];
        bothOpen = Promise.all(pair.map((dc) => new Promise<void>((res, rej) => {
            if (dc.readyState === 'open') return res();
            dc.onopen = () => res();
            dc.onerror = (ev: any) => rej(ev?.error ?? new Error('onerror'));
        })));
    } else {
        const dc1 = pc1.createDataChannel(label, options);
        bothOpen = Promise.all([
            new Promise<void>((res, rej) => {
                if (dc1.readyState === 'open') return res();
                dc1.onopen = () => res();
                dc1.onerror = (ev: any) => rej(ev?.error ?? new Error('onerror'));
            }),
            new Promise<RTCDataChannel>((res, rej) => {
                pc2.ondatachannel = (ev) => {
                    const dc2 = ev.channel;
                    if (dc2.readyState === 'open') return res(dc2);
                    dc2.onopen = () => res(dc2);
                    dc2.onerror = (e: any) => rej(e?.error ?? new Error('onerror'));
                };
            }).then((dc2) => { pair[1] = dc2; }),
        ]);
        pair = [dc1, undefined as unknown as RTCDataChannel];
    }

    await exchangeOfferAnswer(pc1, pc2);
    await bothOpen;
    return [pair[0], pair[1], pc1, pc2];
}

/** Port of WPT `awaitMessage(channel)` — resolves with the next incoming data. */
export function awaitMessage<T = unknown>(channel: RTCDataChannel): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const messageHandler = (ev: MessageEvent) => {
            channel.removeEventListener('message', messageHandler);
            channel.removeEventListener('error', errorHandler);
            resolve(ev.data as T);
        };
        const errorHandler = (ev: any) => {
            channel.removeEventListener('message', messageHandler);
            channel.removeEventListener('error', errorHandler);
            reject(ev?.error ?? new Error('channel error'));
        };
        channel.addEventListener('message', messageHandler);
        channel.addEventListener('error', errorHandler);
    });
}

/**
 * Mirror WPT's `EventWatcher(t, target, events)` — accumulates events in
 * order and returns `wait_for(types)` that matches the expected sequence.
 */
export class EventWatcher {
    private _events: string[] = [];
    private _waiters: Array<{ types: string[]; resolve: () => void; reject: (e: Error) => void }> = [];

    constructor(target: EventTarget, eventTypes: string[]) {
        for (const type of eventTypes) {
            target.addEventListener(type, () => {
                this._events.push(type);
                this._tryResolve();
            });
        }
    }

    wait_for(expected: string | string[]): Promise<void> {
        const types = Array.isArray(expected) ? expected : [expected];
        return new Promise((resolve, reject) => {
            this._waiters.push({ types, resolve, reject });
            this._tryResolve();
        });
    }

    private _tryResolve(): void {
        while (this._waiters.length > 0 && this._events.length >= this._waiters[0].types.length) {
            const waiter = this._waiters.shift()!;
            const got = this._events.splice(0, waiter.types.length);
            const matches = waiter.types.every((t, i) => got[i] === t);
            if (matches) {
                waiter.resolve();
            } else {
                waiter.reject(new Error(`EventWatcher: expected ${JSON.stringify(waiter.types)}, got ${JSON.stringify(got)}`));
            }
        }
    }
}

/** Close an array of RTCPeerConnection instances, ignoring errors. */
export function closePeerConnections(...pcs: (RTCPeerConnection | undefined)[]): void {
    for (const pc of pcs) {
        try { pc?.close(); } catch { /* ignore */ }
    }
}

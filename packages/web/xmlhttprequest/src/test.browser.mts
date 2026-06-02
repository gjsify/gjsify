// Browser test entry for @gjsify/xmlhttprequest.
// In a real browser XMLHttpRequest is provided natively, so this entry
// exercises the native global rather than the GJS implementation (which is
// backed by `gi://GLib`, `system` and `@gjsify/fetch` and is GJS-only).
// Assertions stay valid in a plain browser without any live network: we only
// construct an XHR, inspect its initial state, the readyState transition on
// open(), and the standard readyState constants.
import { run, describe, it, expect } from '@gjsify/unit';

const testSuite = async () => {
    await describe('XMLHttpRequest (constructor)', async () => {
        await it('is a constructor', async () => {
            expect(typeof XMLHttpRequest).toBe('function');
        });

        await it('constructs an instance', async () => {
            const xhr = new XMLHttpRequest();
            expect(xhr instanceof XMLHttpRequest).toBe(true);
        });
    });

    await describe('XMLHttpRequest (instance API)', async () => {
        await it('exposes open() and send() methods', async () => {
            const xhr = new XMLHttpRequest();
            expect(typeof xhr.open).toBe('function');
            expect(typeof xhr.send).toBe('function');
            expect(typeof xhr.abort).toBe('function');
            expect(typeof xhr.setRequestHeader).toBe('function');
        });

        await it('starts in the UNSENT state', async () => {
            const xhr = new XMLHttpRequest();
            expect(xhr.readyState).toBe(XMLHttpRequest.UNSENT);
            expect(xhr.readyState).toBe(0);
        });

        await it('transitions to OPENED after open()', async () => {
            const xhr = new XMLHttpRequest();
            // file: scheme keeps this offline — no network request is sent.
            xhr.open('GET', 'about:blank');
            expect(xhr.readyState).toBe(XMLHttpRequest.OPENED);
            expect(xhr.readyState).toBe(1);
        });
    });

    await describe('XMLHttpRequest (readyState constants)', async () => {
        await it('exposes the standard readyState constants', async () => {
            expect(XMLHttpRequest.UNSENT).toBe(0);
            expect(XMLHttpRequest.OPENED).toBe(1);
            expect(XMLHttpRequest.HEADERS_RECEIVED).toBe(2);
            expect(XMLHttpRequest.LOADING).toBe(3);
            expect(XMLHttpRequest.DONE).toBe(4);
        });
    });
};

run({ testSuite });

// Tests for BrowserCore — the platform-agnostic history stack + routing.
// WebView-free: drives BrowserCore over a fake IFrameHandle so it runs headless
// (the live WebKit window is covered by the gjsify browse e2e).

import { describe, it, expect } from '@gjsify/unit';

import { BrowserCore, type IFrameHandle, type NavState } from './browser-core.js';

/** Minimal IFrameHandle stand-in — tracks the last src/srcdoc set, like a real
 *  iframe where setting one clears the other. contentWindow stays null (the
 *  message listener is a no-op in these tests). */
class FakeIFrame implements IFrameHandle {
    // Stored independently — like the real HTMLIFrameElement, setting one does
    // NOT clear the other (srcdoc takes precedence per the HTML spec). So a
    // test can verify that BrowserCore itself keeps them mutually exclusive.
    private _src = '';
    private _srcdoc = '';
    get src(): string {
        return this._src;
    }
    set src(value: string) {
        this._src = value;
    }
    get srcdoc(): string {
        return this._srcdoc;
    }
    set srcdoc(value: string) {
        this._srcdoc = value;
    }
    get contentWindow(): null {
        return null;
    }
}

export default async () => {
    await describe('BrowserCore history stack', async () => {
        await it('navigate pushes onto the stack and updates currentUrl', async () => {
            const core = new BrowserCore(new FakeIFrame());
            core.navigate('page:welcome');
            expect(core.currentUrl).toBe('page:welcome');
            expect(core.canGoBack).toBe(false);
            expect(core.canGoForward).toBe(false);
        });

        await it('back / forward move through history', async () => {
            const core = new BrowserCore(new FakeIFrame());
            core.navigate('page:a');
            core.navigate('page:b');
            expect(core.canGoBack).toBe(true);
            core.back();
            expect(core.currentUrl).toBe('page:a');
            expect(core.canGoForward).toBe(true);
            core.forward();
            expect(core.currentUrl).toBe('page:b');
        });

        await it('navigate after back truncates forward history', async () => {
            const core = new BrowserCore(new FakeIFrame());
            core.navigate('page:a');
            core.navigate('page:b');
            core.back();
            core.navigate('page:c');
            expect(core.currentUrl).toBe('page:c');
            expect(core.canGoForward).toBe(false);
        });

        await it('emits a NavState on navigate', async () => {
            const core = new BrowserCore(new FakeIFrame());
            const states: NavState[] = [];
            core.onStateChange((s) => states.push(s));
            core.navigate('page:x');
            expect(states.length).toBe(1);
            expect(states[0]!.url).toBe('page:x');
        });

        await it('routes a real URL to src and a page:* URL to srcdoc', async () => {
            const fake = new FakeIFrame();
            const core = new BrowserCore(fake);
            core.navigate('https://example.com');
            expect(fake.src).toBe('https://example.com');
            core.navigate('page:welcome');
            expect(fake.srcdoc.length > 0).toBe(true);
        });

        await it('keeps src and srcdoc mutually exclusive across transitions', async () => {
            // Regression: srcdoc takes precedence over src (HTML spec), so a
            // page:* must clear src and a real URL must clear srcdoc — otherwise
            // navigating back to a real URL after a built-in page leaves the
            // stale srcdoc showing.
            const fake = new FakeIFrame();
            const core = new BrowserCore(fake);
            core.navigate('page:welcome');
            expect(fake.srcdoc.length > 0).toBe(true);
            expect(fake.src).toBe('');
            core.navigate('https://example.com');
            expect(fake.src).toBe('https://example.com');
            expect(fake.srcdoc).toBe('');
            core.navigate('page:about');
            expect(fake.srcdoc.length > 0).toBe(true);
            expect(fake.src).toBe('');
        });
    });
};

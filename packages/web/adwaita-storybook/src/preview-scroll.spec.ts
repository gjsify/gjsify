// Where the preview area's scroll BOUND actually lands.
//
// WHY THIS IS THE FIRST TEST IN THIS PACKAGE. The web preview stopped scrolling
// entirely: a tall story ended mid-page and nothing below was reachable. Every
// layer's CSS was individually valid — the overlay split view held itself to the
// window height, the scroller declared overflow: auto and min-height: 0 — but the
// slotted pane between them had no rule in this target, so it grew to the content's
// height and handed the scroller a bound equal to its own content. clientHeight ===
// scrollHeight, nothing to scroll, remainder clipped by an overflow: hidden further
// up.
//
// Nothing could have caught that by reading state or class names, which is all the
// sibling suites do. The rule this encodes: a layout has to be asserted by WHERE
// things land — measure the box, not the declaration.
//
// Runs in the tests/browser Playwright harness, which drives FIREFOX in CI, not just
// Chromium.

import { describe, expect, it } from '@gjsify/unit';

// Registers the custom elements the storybook chrome is built from, and injects the
// adwaita-web stylesheet. Without it the panes are unstyled inline boxes and every
// measurement below would be meaningless rather than wrong.
import '@gjsify/adwaita-web';

import type { StoryMeta } from '@gjsify/stories';
import { StoryElement } from './story-element.js';
import { mountStorybook } from './app.js';
import type { WebStoryModule } from './types.js';

/** A story deliberately taller than any host we mount it in. */
class TallStory extends StoryElement {
    constructor() {
        super(TallStory.getMetadata(), 'Default');
    }

    /** Part of the authoring contract the registry instantiates through. */
    static getMetadata(): StoryMeta {
        return { title: 'Probe/Tall', description: 'taller than its host on purpose', controls: [] };
    }

    initialize(): void {
        const filler = document.createElement('div');
        filler.style.height = '1600px';
        filler.style.width = '100%';
        this.addContent(filler);
    }
}

const HOST_HEIGHT = 600;

/** Mount the storybook in a fixed-height host and hand back its preview scroller. */
function mountTall(): { host: HTMLElement; scroller: HTMLElement } {
    const host = document.createElement('div');
    // A definite height, because that is the whole question: the real page gives the
    // window one and the chain has to carry it down.
    host.style.height = `${HOST_HEIGHT}px`;
    host.style.width = '900px';
    document.body.append(host);

    const module: WebStoryModule = { stories: [TallStory] };
    mountStorybook(host, { stories: [module], title: 'Probe' });

    const scroller = host.querySelector('.sb-preview-scroll') as HTMLElement | null;
    if (!scroller) throw new Error('no .sb-preview-scroll after mount — the chrome changed shape');
    return { host, scroller };
}

export const AdwStorybookPreviewScrollTest = async () => {
    await describe('storybook preview scrolling', async () => {
        await it('bounds the scroller by its host rather than by its content', () => {
            const { host, scroller } = mountTall();
            try {
                // The defect in one assertion: the scroller was 1008px tall inside a
                // 697px bound because the pane above it ignored the bound.
                expect(scroller.clientHeight).toBeLessThan(HOST_HEIGHT);
                expect(scroller.clientHeight).toBeGreaterThan(0);
            } finally {
                host.remove();
            }
        });

        await it('can actually scroll when the story is taller than the host', () => {
            const { host, scroller } = mountTall();
            try {
                expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
            } finally {
                host.remove();
            }
        });

        await it('reaches the bottom of the story', () => {
            // Being scrollable is not the same as being able to READ the end: an
            // ancestor clipping at the fold satisfies the two assertions above while
            // the last rows stay unreachable.
            const { host, scroller } = mountTall();
            try {
                scroller.scrollTop = scroller.scrollHeight;
                expect(scroller.scrollTop).toBeGreaterThan(0);
                const reached = scroller.scrollTop + scroller.clientHeight;
                expect(reached).toBeGreaterThan(scroller.scrollHeight - 2);
            } finally {
                host.remove();
            }
        });

        await it('keeps every layer between the bound and the scroller collapsible', () => {
            // The named cause, so a future regression says WHICH layer broke instead of
            // only that scrolling stopped. min-height: auto on any of them re-creates
            // the defect exactly.
            const { host, scroller } = mountTall();
            try {
                let el: HTMLElement | null = scroller;
                const offenders: string[] = [];
                while (el && el !== host) {
                    const style = getComputedStyle(el);
                    if (style.minHeight !== '0px' && style.minHeight !== '0')
                        offenders.push(`${el.tagName.toLowerCase()}.${String(el.className || '-').split(' ')[0]}`);
                    el = el.parentElement;
                }
                expect(offenders).toStrictEqual([]);
            } finally {
                host.remove();
            }
        });

        await it('lets the toolbar view, not this sheet, fill the story-list column', () => {
            // This sheet used to carry its own `.sb-sidebar-scroll { flex: 1 1 auto }`,
            // which held the column up here while every other Adw.ToolbarView content
            // widget in the project still stopped at its last row. The declaration is
            // gone and `adw-toolbar-view` fills its content widget instead, so this
            // asserts the widget rule from the consumer that used to hide its absence.
            const { host } = mountTall();
            try {
                const scroll = host.querySelector('.sb-sidebar-scroll') as HTMLElement;
                const area = scroll.parentElement as HTMLElement;
                const list = host.querySelector('.sb-sidebar-list') as HTMLElement;

                // Two discriminators, without which "scroller height == pane height" is
                // a coincidence: the scroller really is the toolbar view's content, and
                // its own content really is shorter than the pane it has to fill.
                expect(area.classList.contains('adw-toolbar-view-content')).toBe(true);
                expect(list.getBoundingClientRect().height).toBeLessThan(area.getBoundingClientRect().height);

                expect(Math.round(scroll.getBoundingClientRect().height)).toBe(
                    Math.round(area.getBoundingClientRect().height),
                );
            } finally {
                host.remove();
            }
        });
    });
};

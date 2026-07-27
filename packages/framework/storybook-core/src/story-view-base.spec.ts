// @gjsify/storybook-core — StoryViewBase tests.
// Runs on GJS + Node + browser (pure TS, no platform imports). A minimal
// string-node fake chrome stands in for a real renderer's chrome.

import { describe, expect, it } from '@gjsify/unit';
import { ControlType, type StoryArgs, type StoryMeta } from '@gjsify/stories';
import { StoryViewBase, type StoryChrome } from './story-view-base.js';

/** A string-node fake chrome that records the header text + staged content. */
class FakeChrome implements StoryChrome<string> {
    title = '';
    description = '';
    staged: string | null = null;
    constructor(
        readonly root: string,
        readonly hasStage: boolean,
    ) {}
    setStageContent(child: string): void {
        this.staged = child;
    }
    setChromeText(title: string, description: string): void {
        this.title = title;
        this.description = description;
    }
}

/** A minimal concrete subclass over string nodes. */
class FakeStoryView extends StoryViewBase<string> {
    chrome!: FakeChrome;
    emitCount = 0;
    constructor(meta: StoryMeta, story = 'Default', customRoot?: string) {
        super();
        this.initBase(meta, story, customRoot);
    }
    protected createChrome(_meta: StoryMeta, customRoot?: string): StoryChrome<string> {
        this.chrome = new FakeChrome(customRoot ?? 'default-root', customRoot === undefined);
        return this.chrome;
    }
    // Verify emitArgs is overridable (the GTK adapter needs this to ALSO fire notify).
    protected emitArgs(value: StoryArgs): void {
        this.emitCount++;
        super.emitArgs(value);
    }
}

const meta: StoryMeta = {
    title: 'Rows/Action',
    description: 'An action row',
    controls: [
        { type: ControlType.TEXT, name: 'title', label: 'Title', defaultValue: 'Hello' },
        { type: ControlType.BOOLEAN, name: 'on', label: 'On' },
    ],
};

export default async () => {
    await describe('StoryViewBase init', async () => {
        await it('seeds args from the controls and exposes meta/story/root', () => {
            const view = new FakeStoryView(meta);
            expect(view.meta).toBe(meta);
            expect(view.story).toBe('Default');
            expect(view.args).toStrictEqual({ title: 'Hello', on: false });
            expect(view.root).toBe('default-root');
        });

        await it('formats the chrome title as "<title> — <story>"', () => {
            const view = new FakeStoryView(meta, 'Variant');
            expect(view.chrome.title).toBe('Rows/Action — Variant');
            expect(view.chrome.description).toBe('An action row');
        });

        await it('uses the bare title when story is empty', () => {
            const view = new FakeStoryView(meta, '');
            expect(view.chrome.title).toBe('Rows/Action');
        });

        await it('uses a custom root and disables the stage', () => {
            const view = new FakeStoryView(meta, 'Default', 'custom');
            expect(view.root).toBe('custom');
            view.addContent('child');
            expect(view.chrome.staged).toBeNull(); // no-op with a custom root
        });
    });

    await describe('StoryViewBase args + listeners', async () => {
        await it('setArg updates args, fires updateArgs and notifies listeners', () => {
            const view = new FakeStoryView(meta);
            const seen: StoryArgs[] = [];
            view.onArgsChanged((a) => seen.push(a));
            view.setArg('title', 'Changed');
            expect(view.args.title).toBe('Changed');
            expect(seen.length).toBe(1);
            expect(seen[0]!.title).toBe('Changed');
            expect(view.emitCount).toBe(1); // overridable emitArgs ran
        });

        await it('ignores an identical args reference (no notify)', () => {
            const view = new FakeStoryView(meta);
            let count = 0;
            view.onArgsChanged(() => count++);
            const same = view.args;
            view.args = same; // identical reference — the setter must short-circuit
            expect(count).toBe(0);
            expect(view.args).toBe(same);
        });

        await it('unsubscribe stops further notifications', () => {
            const view = new FakeStoryView(meta);
            let count = 0;
            const unsub = view.onArgsChanged(() => count++);
            view.setArg('title', 'a');
            unsub();
            view.setArg('title', 'b');
            expect(count).toBe(1);
        });
    });

    await describe('StoryViewBase addContent', async () => {
        await it('stages content through the default chrome', () => {
            const view = new FakeStoryView(meta);
            view.addContent('preview');
            expect(view.chrome.staged).toBe('preview');
        });
    });
};

// @gjsify/storybook-core — bindControl tests.
// Runs on GJS + Node + browser (pure TS, no platform imports).

import { describe, expect, it } from '@gjsify/unit';
import { ControlType, type StoryArgs, type StoryArgValue, type StoryControl } from '@gjsify/stories';
import { bindControl, type BindableStory, type ControlWidget, type ControlWidgetFactory } from './controls.js';

/** A mock story that records setArg writes and serves an args bag. */
class MockStory implements BindableStory {
    args: StoryArgs;
    writes: Array<[string, StoryArgValue]> = [];
    constructor(args: StoryArgs = {}) {
        this.args = args;
    }
    setArg(name: string, value: StoryArgValue): void {
        this.writes.push([name, value]);
        this.args = { ...this.args, [name]: value };
    }
}

/** A mock leaf widget — a plain value holder + change callback. */
class MockWidget<V> implements ControlWidget<string, V> {
    node = 'node';
    private _value: V;
    private _cb: ((v: V) => void) | null = null;
    constructor(initial: V) {
        this._value = initial;
    }
    get(): V {
        return this._value;
    }
    set(value: V): void {
        this._value = value;
    }
    onChange(cb: (value: V) => void): void {
        this._cb = cb;
    }
    /** Simulate a user-driven change. */
    fire(value: V): void {
        this._value = value;
        this._cb?.(value);
    }
}

/** A factory that hands back fresh MockWidgets and records the last built one per kind. */
class MockFactory implements ControlWidgetFactory<string> {
    last: {
        text?: MockWidget<string>;
        boolean?: MockWidget<boolean>;
        number?: MockWidget<number>;
        range?: MockWidget<number>;
        select?: MockWidget<number>;
        color?: MockWidget<string>;
    } = {};
    text(): ControlWidget<string, string> {
        return (this.last.text = new MockWidget(''));
    }
    boolean(): ControlWidget<string, boolean> {
        return (this.last.boolean = new MockWidget(false));
    }
    number(): ControlWidget<string, number> {
        return (this.last.number = new MockWidget(0));
    }
    range(): ControlWidget<string, number> {
        return (this.last.range = new MockWidget(0));
    }
    select(): ControlWidget<string, number> {
        return (this.last.select = new MockWidget(0));
    }
    color(): ControlWidget<string, string> {
        return (this.last.color = new MockWidget('#000000'));
    }
}

const tControl: StoryControl = { type: ControlType.TEXT, name: 't', label: 'T' };
const bControl: StoryControl = { type: ControlType.BOOLEAN, name: 'b', label: 'B' };
const nControl: StoryControl = { type: ControlType.NUMBER, name: 'n', label: 'N', min: 5, max: 50, step: 1 };
const rControl: StoryControl = { type: ControlType.RANGE, name: 'r', label: 'R', min: 2, max: 20, step: 2 };
const sControl: StoryControl = {
    type: ControlType.SELECT,
    name: 's',
    label: 'S',
    options: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
    ],
};
const cControl: StoryControl = { type: ControlType.COLOR, name: 'c', label: 'C' };

export default async () => {
    await describe('bindControl TEXT', async () => {
        await it('seeds from a string arg and writes on change', () => {
            const story = new MockStory({ t: 'hello' });
            const factory = new MockFactory();
            bindControl(story, tControl, factory);
            expect(factory.last.text!.get()).toBe('hello');
            factory.last.text!.fire('typed');
            expect(story.writes).toStrictEqual([['t', 'typed']]);
        });

        await it('seeds empty when the arg is not a string', () => {
            const story = new MockStory({ t: 42 });
            const factory = new MockFactory();
            bindControl(story, tControl, factory);
            expect(factory.last.text!.get()).toBe('');
        });

        await it('refresh re-syncs only when the value differs', () => {
            const story = new MockStory({ t: 'a' });
            const factory = new MockFactory();
            const row = bindControl(story, tControl, factory)!;
            row.refresh({ t: 'b' });
            expect(factory.last.text!.get()).toBe('b');
            // Non-string refresh falls back to empty.
            row.refresh({ t: 7 });
            expect(factory.last.text!.get()).toBe('');
        });
    });

    await describe('bindControl BOOLEAN', async () => {
        await it('coerces the arg to a boolean and writes on change', () => {
            const story = new MockStory({ b: 1 });
            const factory = new MockFactory();
            const row = bindControl(story, bControl, factory)!;
            expect(factory.last.boolean!.get()).toBe(true);
            factory.last.boolean!.fire(false);
            expect(story.writes).toStrictEqual([['b', false]]);
            row.refresh({ b: 0 });
            expect(factory.last.boolean!.get()).toBe(false);
        });
    });

    await describe('bindControl NUMBER', async () => {
        await it('seeds from a number arg, falls back to min', () => {
            const factory = new MockFactory();
            bindControl(new MockStory({ n: 12 }), nControl, factory);
            expect(factory.last.number!.get()).toBe(12);

            const factory2 = new MockFactory();
            bindControl(new MockStory({}), nControl, factory2);
            expect(factory2.last.number!.get()).toBe(5); // min
        });

        await it('writes the widget value on change; refresh falls back to 0', () => {
            const story = new MockStory({ n: 12 });
            const factory = new MockFactory();
            const row = bindControl(story, nControl, factory)!;
            factory.last.number!.fire(30);
            expect(story.writes).toStrictEqual([['n', 30]]);
            row.refresh({ n: 'x' });
            expect(factory.last.number!.get()).toBe(0);
        });
    });

    await describe('bindControl RANGE', async () => {
        await it('seeds from a number arg, falls back to min, refresh falls back to initial', () => {
            const story = new MockStory({});
            const factory = new MockFactory();
            const row = bindControl(story, rControl, factory)!;
            expect(factory.last.range!.get()).toBe(2); // min
            factory.last.range!.fire(8);
            expect(story.writes).toStrictEqual([['r', 8]]);
            // Non-number refresh falls back to the seeded initial (min=2).
            row.refresh({ r: null });
            expect(factory.last.range!.get()).toBe(2);
        });
    });

    await describe('bindControl SELECT', async () => {
        await it('maps the seeded value to its option index', () => {
            const factory = new MockFactory();
            bindControl(new MockStory({ s: 'b' }), sControl, factory);
            expect(factory.last.select!.get()).toBe(1);
        });

        await it('clamps a non-matching default to index 0', () => {
            const factory = new MockFactory();
            bindControl(new MockStory({ s: 'zzz' }), sControl, factory);
            expect(factory.last.select!.get()).toBe(0);
        });

        await it('writes the chosen index as the option value', () => {
            const story = new MockStory({ s: 'a' });
            const factory = new MockFactory();
            bindControl(story, sControl, factory);
            factory.last.select!.fire(1);
            expect(story.writes).toStrictEqual([['s', 'b']]);
        });

        await it('refresh maps the arg value back to the index', () => {
            const story = new MockStory({ s: 'a' });
            const factory = new MockFactory();
            const row = bindControl(story, sControl, factory)!;
            row.refresh({ s: 'b' });
            expect(factory.last.select!.get()).toBe(1);
        });

        await it('returns null for an options-less SELECT', () => {
            const empty: StoryControl = { type: ControlType.SELECT, name: 's', label: 'S', options: [] };
            expect(bindControl(new MockStory(), empty, new MockFactory())).toBeNull();
        });
    });

    await describe('bindControl COLOR', async () => {
        await it('seeds from a string hex, falls back to #000000', () => {
            const factory = new MockFactory();
            bindControl(new MockStory({ c: '#ff0000' }), cControl, factory);
            expect(factory.last.color!.get()).toBe('#ff0000');

            const factory2 = new MockFactory();
            bindControl(new MockStory({ c: 5 }), cControl, factory2);
            expect(factory2.last.color!.get()).toBe('#000000');
        });

        await it('writes on change and refresh falls back to #000000', () => {
            const story = new MockStory({ c: '#ffffff' });
            const factory = new MockFactory();
            const row = bindControl(story, cControl, factory)!;
            factory.last.color!.fire('#00ff00');
            expect(story.writes).toStrictEqual([['c', '#00ff00']]);
            row.refresh({ c: null });
            expect(factory.last.color!.get()).toBe('#000000');
        });
    });

    await describe('bindControl unsupported', async () => {
        await it('returns null for an unknown control type', () => {
            const bogus = { type: 'bogus', name: 'x', label: 'X' } as unknown as StoryControl;
            expect(bindControl(new MockStory(), bogus, new MockFactory())).toBeNull();
        });
    });
};

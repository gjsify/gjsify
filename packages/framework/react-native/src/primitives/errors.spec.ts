// What a refusal says about WHICH element it refused.
//
// The message's job is to be actionable, and naming the primitive is not enough: an
// application has many elements per primitive. A consumer reported hours spent on a
// `<View> expand` refusal against twenty-five `<View className="flex-1 bg-canvas">`
// sites, and the only way they found the element was to patch the built `lib/` to
// print `props.className`.
//
// So `describeElement` is pinned here rather than left to a reviewer's eye, and the
// cases below are the ones a plausible implementation gets wrong: an ARRAY className,
// which is ordinary authoring (`className={[a, cond && b]}`); a className that is
// only whitespace, where a naive implementation emits `className=""` and says
// nothing; and a long computed list, where a message that scrolls is a message
// nobody reads.
//
// THE OPTIONAL ARGUMENT IS ALSO PINNED, because it is what keeps ADR 0039 § 1's "same
// string" true: `prop-table`'s static answers call `primitiveErrorMessage` with three
// arguments and must produce exactly what they produced before.

import { describe, expect, it } from '@gjsify/unit';

import { describeElement, PrimitiveError, primitiveErrorMessage } from './errors.js';

export default async () => {
    await describe('describeElement', async () => {
        await it('names a plain className', async () => {
            expect(describeElement({ className: 'flex-1 bg-canvas' })).toBe('[className="flex-1 bg-canvas"]');
        });

        await it('flattens an array, which is how half of them are written', async () => {
            expect(describeElement({ className: ['flex-1', false, null, 'bg-canvas'] })).toBe(
                '[className="flex-1 bg-canvas"]',
            );
        });

        await it('collapses the whitespace an array join leaves behind', async () => {
            expect(describeElement({ className: '  flex-1\n  bg-canvas ' })).toBe('[className="flex-1 bg-canvas"]');
        });

        await it('says nothing rather than nothing-in-quotes', async () => {
            // An empty clause is worse than no clause: it reads as "the author wrote
            // an empty className", which is a different fact from "there is none".
            expect(describeElement({})).toBe('');
            expect(describeElement({ className: '   ' })).toBe('');
            expect(describeElement({ className: [] })).toBe('');
            expect(describeElement({ className: null })).toBe('');
        });

        await it('carries testID beside it, and only when it is a non-empty string', async () => {
            expect(describeElement({ className: 'p-2', testID: 'save' })).toBe('[className="p-2" testID="save"]');
            expect(describeElement({ testID: 'save' })).toBe('[testID="save"]');
            expect(describeElement({ testID: '' })).toBe('');
            expect(describeElement({ testID: 7 })).toBe('');
        });

        await it('caps a long list, because a refusal that scrolls is unread', async () => {
            const long = Array.from({ length: 40 }, (_, i) => `class-number-${i}`).join(' ');
            const described = describeElement({ className: long });
            expect(described.length <= 135).toBe(true);
            expect(described.endsWith('…"]')).toBe(true);
        });
    });

    await describe('primitiveErrorMessage', async () => {
        await it('is unchanged with three arguments', async () => {
            // ADR 0039 § 1: the static answer and the thrown message are ONE string.
            // `prop-table` calls this with three, so three must still produce what it
            // always produced.
            expect(primitiveErrorMessage('View', 'prop "x"', 'is refused')).toBe(
                '@gjsify/react-native: <View> prop "x" — is refused',
            );
        });

        await it('appends the element clause when there is one', async () => {
            expect(primitiveErrorMessage('View', 'expand', 'needs a parent', '[className="flex-1"]')).toBe(
                '@gjsify/react-native: <View> expand — needs a parent [className="flex-1"]',
            );
        });
    });

    await describe('PrimitiveError', async () => {
        await it('keeps the fields a consumer reads, including the new one', async () => {
            const error = new PrimitiveError('View', 'expand', 'needs a parent', '[testID="bar"]');
            expect(error.primitive).toBe('View');
            expect(error.subject).toBe('expand');
            expect(error.where).toBe('[testID="bar"]');
            expect(error.name).toBe('PrimitiveError');
        });

        await it('defaults the clause to empty, so every existing throw is unchanged', async () => {
            const error = new PrimitiveError('Text', 'prop "onPress"', 'a label emits no clicked');
            expect(error.where).toBe('');
            expect(error.message).toBe('@gjsify/react-native: <Text> prop "onPress" — a label emits no clicked');
        });
    });
};

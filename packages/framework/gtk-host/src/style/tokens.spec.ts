// The token scales — pure TypeScript, so this runs without a display or a widget.
//
// The module used to be two lookups and a constant, and needed no spec of its own.
// It now holds three DECISIONS, and each of them is the kind that is invisible when
// it is wrong: an opt-in set whose whole value is what it deliberately does NOT
// carry, a merge whose depth is the difference between working and silently losing a
// token, and an error hint that is only useful when it stays out of the way.

import { describe, expect, it } from '@gjsify/unit';

import { UnknownUtilityError } from './errors.js';
import { resolveUtility } from './resolve.js';
import {
    MINIMAL_TOKENS,
    TAILWIND_DEFAULT_TOKENS,
    mergeTokens,
    requireToken,
    tailwindDefaultHint,
    type StyleTokens,
} from './tokens.js';

/** A token file's own vocabulary — generated from a design source, Tailwind-free. */
const PROJECT: StyleTokens = {
    spacing: { '2xs': '4px', xs: '8px', s: '12px', m: '16px' },
    colors: { emphasis: 'rgb(17 34 51)', muted: 'rgb(120 120 120)' },
    borderRadius: { s: '4px', m: '8px', l: '12px' },
    fontSize: { caption: '11px', body: '14px' },
};

const threw = (fn: () => unknown): UnknownUtilityError => {
    try {
        fn();
    } catch (error) {
        if (error instanceof UnknownUtilityError) return error;
        throw error;
    }
    throw new Error('expected an UnknownUtilityError, nothing was thrown');
};

export default async () => {
    await describe('the measured gap a project’s own @theme leaves', async () => {
        await it('is exactly the tokens nobody would declare: 0 and full', async () => {
            // The five of six measured failures, reproduced as vectors. A project
            // that declares its whole spacing and radius vocabulary still has no
            // `full` and no `0`, because neither is a value a designer picks.
            for (const utility of ['inset-0', 'top-0', 'left-0', 'right-0']) {
                expect(threw(() => resolveUtility(utility, PROJECT)).message).toContain('not in the spacing scale');
            }
            expect(threw(() => resolveUtility('rounded-full', PROJECT)).message).toContain(
                'not in the borderRadius scale',
            );
        });

        await it('closes with the opt-in, merged per TOKEN', async () => {
            const tokens = mergeTokens(TAILWIND_DEFAULT_TOKENS, PROJECT);
            expect(resolveUtility('inset-0', tokens)).toStrictEqual({
                top: '0px',
                right: '0px',
                bottom: '0px',
                left: '0px',
            });
            expect(resolveUtility('rounded-full', tokens)).toStrictEqual({ borderRadius: '9999px' });
            // …without the project losing anything it declared.
            expect(resolveUtility('mt-m', tokens)).toStrictEqual({ marginTop: '16px' });
            expect(resolveUtility('rounded-l', tokens)).toStrictEqual({ borderRadius: '12px' });
        });

        await it('is NOT closed by a spread, which is why mergeTokens exists', async () => {
            // The bug the helper answers, asserted rather than described. An object
            // spread replaces whole SCALES, so a project declaring any `spacing`
            // loses `0` again — and finds out at `inset-0`, far from the line that
            // did it.
            const spread: StyleTokens = { ...TAILWIND_DEFAULT_TOKENS, ...PROJECT };
            expect(threw(() => resolveUtility('inset-0', spread)).message).toContain('not in the spacing scale');
        });

        await it('lets the project override a default token rather than being shadowed by it', async () => {
            // Later sets win token by token, which is what "my values on top of the
            // defaults" means. A project whose hairline is 2px keeps it.
            const tokens = mergeTokens(TAILWIND_DEFAULT_TOKENS, { spacing: { px: '2px' } });
            expect(resolveUtility('mt-px', tokens)).toStrictEqual({ marginTop: '2px' });
            expect(resolveUtility('mt-0', tokens)).toStrictEqual({ marginTop: '0px' });
        });
    });

    await describe('what the opt-in deliberately does not carry', async () => {
        await it('ships no numeric ladder, because that IS the project’s decision', async () => {
            // Shipping `spacing-4` … `spacing-96` would ship a design decision the
            // project has already made differently. `4` staying unknown under the
            // opt-in is the behaviour, not an omission.
            expect(Object.keys(TAILWIND_DEFAULT_TOKENS.spacing ?? {}).sort()).toStrictEqual(['0', 'px']);
            expect(threw(() => resolveUtility('mt-4', TAILWIND_DEFAULT_TOKENS)).message).toContain('spacing scale');
        });

        await it('spells every length in px, because the widget channel stores gint', async () => {
            // A `rem` token pads and cannot margin — `Gtk.Widget:margin-top` is a
            // gint of device pixels with no unit conversion behind it. A rem-faithful
            // copy of Tailwind's defaults would trade "the token is missing" for "the
            // token throws on half the families".
            const lengths = [
                ...Object.values(TAILWIND_DEFAULT_TOKENS.spacing ?? {}),
                ...Object.values(TAILWIND_DEFAULT_TOKENS.borderRadius ?? {}),
                ...Object.values(TAILWIND_DEFAULT_TOKENS.borderWidth ?? {}),
            ];
            expect(lengths.filter((value) => /r?em|%/.test(value))).toStrictEqual([]);
        });

        await it('omits the colour keyword whose alpha form GTK refuses', async () => {
            // `color: inherit` parses and `alpha(inherit, 0.5)` does not (measured),
            // so `bg-inherit/50` would be a refusal rather than a colour. The other
            // four keywords survive the modifier and are carried.
            expect(Object.keys(TAILWIND_DEFAULT_TOKENS.colors ?? {}).sort()).toStrictEqual([
                'black',
                'current',
                'transparent',
                'white',
            ]);
        });

        await it('leaves MINIMAL_TOKENS as small as it was', async () => {
            // The opt-in is not a retreat from the smallness decision, and this is
            // the line that would go red if someone widened the default instead.
            expect(Object.keys(MINIMAL_TOKENS.spacing ?? {}).sort()).toStrictEqual(['0', 'px']);
            expect(Object.keys(MINIMAL_TOKENS.fontWeight ?? {}).length).toBe(4);
        });
    });

    await describe('the hint on a scale miss', async () => {
        await it('names the opt-in for a token Tailwind’s defaults DO define', async () => {
            const error = threw(() => resolveUtility('rounded-full', PROJECT));
            expect(error.message).toContain('TAILWIND_DEFAULT_TOKENS');
            expect(error.message).toContain('mergeTokens');
            // The VALUE, so a reader who wants the one token instead of the set can
            // copy it rather than look it up.
            expect(error.message).toContain('9999px');
        });

        await it('stays silent for an ordinary typo, which the opt-in would not fix', async () => {
            // A remedy offered where it would not have helped is worse than none: it
            // sends a reader to add a dependency instead of to fix the spelling.
            const error = threw(() => resolveUtility('mt-nonsuch', PROJECT));
            expect(error.message).toContain('spacing scale');
            expect(error.message.includes('TAILWIND_DEFAULT_TOKENS')).toBe(false);
        });

        await it('reads the scale by NAME, so a caller cannot ask the wrong one', async () => {
            expect(tailwindDefaultHint('borderRadius', 'full')).toContain('9999px');
            expect(tailwindDefaultHint('spacing', 'full')).toBe('');
            expect(tailwindDefaultHint('nonsuch', '0')).toBe('');
        });

        await it('reaches the w-*/h-* path, which reads two scales', async () => {
            // `requireSize` builds its own message and would have been the one place
            // the hint was missing — `w-0` is as ordinary as `inset-0`.
            const error = threw(() => resolveUtility('w-0', PROJECT));
            expect(error.message).toContain('TAILWIND_DEFAULT_TOKENS');
        });

        await it('reaches requireToken directly, for a caller outside the families', async () => {
            expect(
                threw(() => requireToken(PROJECT.borderRadius, 'full', 'rounded-full', 'borderRadius')).message,
            ).toContain('TAILWIND_DEFAULT_TOKENS');
        });
    });
};

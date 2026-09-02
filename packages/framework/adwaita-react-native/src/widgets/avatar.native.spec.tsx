/** @jsxImportSource react */
// The React Native half of `AdwAvatar`, rendered through React's real reconciler.
//
// EVERY NUMBER HERE IS ONE THE GTK HALF IS ALSO ASSERTED WITH, and for this widget the
// join is unusually tight: `set_class_color` PUBLISHES its answer as a CSS class, so
// `content.gtk.spec.tsx` reads `color11` off the live GTK tree for "Ada Lovelace" and
// this file asserts the eleventh palette entry's flattened fill, `#8c75d9`. Neither side
// computed the other's value — one ran libadwaita's C, one ran
// `@gjsify/adwaita-core`'s port of `g_str_hash` over UTF-8 bytes.
//
// TWO NAMES, NOT ONE. A single name agreeing proves the two sides landed in the same
// bucket once, and the derivation's actual content is the hash: a renderer hashing UTF-16
// code units instead of UTF-8 bytes lands on the same bucket for plenty of ASCII names,
// which is how two renderers in this repository shipped the wrong colour for every
// accented name while their suites stayed green. "Grace Hopper" is the control, and it
// lands on a different entry.
//
// THE COLOURS ARE WRITTEN OUT rather than read back from `AVATAR_COLORS`. Asserting
// `flattenAvatarGradient(avatarColor(name))` against itself would be a test of nothing;
// the literal is what a change to the palette, to the hash or to the blend has to walk
// past.
//
// The harness — `act`, the renderer, the child readers — is `../testing/render.spec.ts`.
// On `act()` and the missing production define, see `clamp.native.spec.tsx` — the
// measurement is the same and lives there.

import { describe, expect, it } from '@gjsify/unit';

import { RCT_TEXT, RCT_VIEW } from '../testing/react-native.js';
import { childrenOf, mounted, onlyChild, type Style } from '../testing/render.spec.js';
import { AdwAvatar } from './avatar.native.js';

/** The size `content.gtk.spec.tsx` builds its avatars at. */
const SIZE = 48;

/**
 * `avatarMaxFontSize(48)` — `48 / 1.4142` less the size-proportional padding
 * `max(48 * 0.4 - 5, 0)`, to the last bit of the double.
 *
 * Written out for the same reason the colours are: the alternative is the implementation
 * asserting itself. It is also the number the NativeScript port's `size * 0.4` heuristic
 * has to stay under, and above ~54 points it does not.
 */
const MAX_FONT_SIZE_48 = 19.74145099703012;

export default async () => {
    await describe('AdwAvatar on React Native — the circle it asks for', async () => {
        await it('is a round view sized by the required size prop', async () => {
            const tree = mounted(<AdwAvatar size={SIZE} text="Ada Lovelace" showInitials={true} />);
            expect(tree.type).toBe(RCT_VIEW);
            const style = tree.props.style as Record<string, unknown>;
            expect(style.width).toBe(SIZE);
            expect(style.height).toBe(SIZE);
            // Half the diameter is what makes a square a circle, and it is the one
            // geometric fact this widget has.
            expect(style.borderRadius).toBe(24);
        });

        await it('paints the eleventh palette entry for “Ada Lovelace”, as GTK stamps color11', async () => {
            const tree = mounted(<AdwAvatar size={SIZE} text="Ada Lovelace" showInitials={true} />);
            // `#8c75d9` is `flattenAvatarGradient` over `#9e91e8` → `#7a59ca`, the
            // violet entry the GTK half reaches as `color11`. A React Native style has
            // no gradient key, which is why the blend exists at all.
            expect((tree.props.style as Record<string, unknown>).backgroundColor).toBe('#8c75d9');
            const label = onlyChild(tree);
            expect(label.type).toBe(RCT_TEXT);
            expect(label.children).toStrictEqual(['AL']);
            expect(label.props.style as Style).toStrictEqual({
                color: '#d5d2f5',
                fontSize: MAX_FONT_SIZE_48,
                display: 'flex',
            });
        });

        await it('lands on a DIFFERENT entry for “Grace Hopper” — the control', async () => {
            const tree = mounted(<AdwAvatar size={SIZE} text="Grace Hopper" showInitials={true} />);
            // GTK stamps `color6` for this name; `#eba831` is that entry blended.
            expect((tree.props.style as Record<string, unknown>).backgroundColor).toBe('#eba831');
            expect(onlyChild(tree).children).toStrictEqual(['GH']);
        });

        await it('takes the initials from CODE POINTS, so an accented name survives', async () => {
            // `extract_initials_from_text` upcases, strips and NFC-normalises, then reads
            // whole characters. `charAt(0)` would return half a surrogate pair here and
            // an ASCII-only fold would drop the accent — and the colour bucket follows the
            // BYTES, so both would move the avatar as well as the letter.
            const tree = mounted(<AdwAvatar size={SIZE} text="Édouard Lucas" showInitials={true} />);
            expect(onlyChild(tree).children).toStrictEqual(['ÉL']);
            expect((tree.props.style as Record<string, unknown>).backgroundColor).toBe('#e5c031');
        });
    });

    await describe('AdwAvatar on React Native — the two modes it has', async () => {
        await it('hides the initials without show-initials but KEEPS the colour', async () => {
            // MEASURED on libadwaita 1.9.3 and asserted on the GTK half too: the gizmo
            // still carries `color11` in icon mode, so the circle keeps its gradient. The
            // browser renderer clears its background there; this follows the widget.
            const tree = mounted(<AdwAvatar size={SIZE} text="Ada Lovelace" />);
            expect((tree.props.style as Record<string, unknown>).backgroundColor).toBe('#8c75d9');
            expect((onlyChild(tree).props.style as Record<string, unknown>).display).toBe('none');
        });

        await it('renders NO glyph in icon mode, which is the divergence', async () => {
            // PINNED, not asserted as correct. React Native resolves no icon theme, so
            // `adw-avatar-default-symbolic` has nothing to become and the icon mode is a
            // coloured circle with the label hidden — where GTK draws the symbolic. A
            // later edit that starts drawing something has to change this row.
            const tree = mounted(<AdwAvatar size={SIZE} text="Ada Lovelace" iconName="face-smile-symbolic" />);
            const children = childrenOf(tree);
            expect(children.length).toBe(1);
            expect(children[0]?.type).toBe(RCT_TEXT);
        });

        await it('stays in initials mode for a whitespace-only name, with a blank label', async () => {
            // The gate is the length of the TEXT, not of the derived initials —
            // `update_visibility` keeps a whitespace-only name in initials mode, and a
            // renderer keying on the initials would fall back to the icon instead.
            const tree = mounted(<AdwAvatar size={SIZE} text="   " showInitials={true} />);
            const label = onlyChild(tree);
            expect((label.props.style as Record<string, unknown>).display).toBe('flex');
            expect(label.children).toBe(null);
        });
    });
};

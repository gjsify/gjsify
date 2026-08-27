// SPDX-License-Identifier: MIT
//
// The design-system layer: a dozen components written against React Native's
// vocabulary and NOTHING else. There is no `gi://` import in this file, no GTK
// property name, no widget name and no `<gtk-*>` element — which is the claim the
// showcase exists to make measurable. Every widget in the window is chosen by
// `@gjsify/react-native`'s L2 table out of a `<View>`, a `<Text>`, a `<Pressable>`,
// a `<ScrollView>`, a `<TextInput>`, a `<Switch>` and an `<ActivityIndicator>`.
//
// SHAPED LIKE A REAL ONE, and the shape is what makes it a proof rather than a
// gallery: every component takes `className` and merges it last, so the screen can
// override any of them, and 24 of the measured application's class sites are
// computed rather than literal (ADR 0032 § 3) — which is why the props below build
// ARRAYS and let `false` fall through, exactly as a `clsx`-shaped call site does.
//
// THREE VOCABULARY FACTS THIS FILE IS WRITTEN AROUND, each a named refusal rather
// than a preference:
//
//   · `justify-between` IS REFUSED (`Gtk.CenterBox` installs no `remove`, measured),
//     so `ActionRow` and `SectionHeader` spell the distribution the way L1's own
//     message asks for: a `flex-1` spacer child. `justify-end` and `justify-center`
//     DO resolve — to the box's own main-axis alignment — and are used where that is
//     what the layout means.
//   · `active:` MAY ONLY CARRY PAINT. `active:opacity-70` becomes a GTK CSS
//     `:active` rule on the generated class and costs no re-render at all;
//     `active:flex-1` would be a widget property, which has no pseudo-class form,
//     and is refused. So the pressed state of every pressable here is colour and
//     opacity and never React state.
//   · A `<Text>` TAKES NO ELEMENT CHILDREN — a `Gtk.Label` has none (measured), so
//     React Native's nested-`<Text>` inline-styling idiom has no counterpart. The
//     type ramp below is therefore a set of leaf components over a string, which is
//     also how 229 of the measured application's 233 `Text` uses were already
//     written.

import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from '@gjsify/react-native';
import type { ReactNode } from 'react';

/**
 * The class list a component forwards from its caller.
 *
 * NOT the layer's own `ClassNameInput`, and the difference is a real limit rather
 * than a simplification: that type's array form does NOT nest — its members are
 * `string | false | null | undefined` — so `className={[base, caller]}` type-checks
 * only while `caller` is a single value. A design system whose call sites build class
 * lists with a `clsx`-shaped helper therefore has to flatten before it hands one
 * down, or accept one level, which is what this does.
 */
type ClassName = string | false | null | undefined;

interface Styleable {
    readonly className?: ClassName;
    readonly testID?: string;
}

interface TextProps extends Styleable {
    readonly children: string;
}

// ---------------------------------------------------------------------------
// typography — one component per ramp step, over a string
// ---------------------------------------------------------------------------

export function Display({ children, className, testID }: TextProps) {
    return (
        <Text className={['text-display font-bold text-ink leading-snug', className]} testID={testID}>
            {children}
        </Text>
    );
}

export function Title({ children, className, testID }: TextProps) {
    return (
        <Text className={['text-title font-medium text-ink', className]} testID={testID}>
            {children}
        </Text>
    );
}

/**
 * Body copy, and the one place `numberOfLines` earns its keep.
 *
 * L2 sends it to `Gtk.Label:lines` WITH `ellipsize: end` and `wrap: true`, because
 * `lines` alone does nothing — the property is honoured only while the label both
 * wraps and ellipsizes. A component that set only `lines` would render every line
 * and look like the prop was ignored.
 */
export function Body({ children, className, lines, testID }: TextProps & { readonly lines?: number }) {
    return (
        <Text className={['text-body text-ink leading-snug', className]} numberOfLines={lines} testID={testID}>
            {children}
        </Text>
    );
}

export function Caption({ children, className, testID }: TextProps) {
    return (
        <Text className={['text-caption text-muted opacity-80', className]} testID={testID}>
            {children}
        </Text>
    );
}

/** The all-caps label above a field. `uppercase` + `tracking-wide` are both GTK CSS. */
export function Overline({ children, className, testID }: TextProps) {
    return (
        <Text className={['text-caption font-bold text-muted uppercase tracking-wide', className]} testID={testID}>
            {children}
        </Text>
    );
}

// ---------------------------------------------------------------------------
// badge · chip · button
// ---------------------------------------------------------------------------

export type Tone = 'neutral' | 'accent' | 'positive';

const BADGE_FILL: Readonly<Record<Tone, string>> = {
    neutral: 'bg-sunken',
    accent: 'bg-accent',
    positive: 'bg-positive',
};

export function Badge({ children, tone = 'neutral', className, testID }: TextProps & { readonly tone?: Tone }) {
    return (
        <View
            className={['flex-row items-center rounded-pill px-xs py-2xs', BADGE_FILL[tone], className]}
            testID={testID}
        >
            <Text className={['text-caption font-bold', tone === 'neutral' ? 'text-muted' : 'text-inverse']}>
                {children}
            </Text>
        </View>
    );
}

/**
 * A selectable pill.
 *
 * The selected state is TWO class swaps and no widget property, which is the
 * measured shape of the vocabulary: two thirds of it becomes widget properties and
 * one third becomes GTK CSS, and a selection is entirely in the second third. The
 * pressed state is neither — it is the `:active` rule GTK animates on its own.
 */
export function Chip({
    children,
    selected = false,
    onPress,
    className,
    testID,
}: TextProps & { readonly selected?: boolean; readonly onPress?: () => void }) {
    return (
        <Pressable
            className={[
                'rounded-pill border px-s py-2xs active:opacity-80',
                selected ? 'bg-accent border-accent' : 'bg-surface border-line',
                className,
            ]}
            onPress={onPress}
            testID={testID}
        >
            <Text className={['text-caption font-medium', selected ? 'text-inverse' : 'text-muted']}>{children}</Text>
        </Pressable>
    );
}

export type ButtonVariant = 'primary' | 'quiet';

export function Button({
    children,
    variant = 'primary',
    onPress,
    disabled,
    className,
    testID,
}: TextProps & {
    readonly variant?: ButtonVariant;
    readonly onPress?: () => void;
    readonly disabled?: boolean;
}) {
    return (
        <Pressable
            className={[
                'rounded-md px-m py-xs',
                variant === 'primary'
                    ? 'bg-accent active:opacity-70'
                    : 'bg-surface border border-line active:bg-sunken',
                disabled === true && 'opacity-60',
                className,
            ]}
            onPress={onPress}
            disabled={disabled}
            testID={testID}
        >
            <Text className={['text-body font-medium', variant === 'primary' ? 'text-inverse' : 'text-ink']}>
                {children}
            </Text>
        </Pressable>
    );
}

// ---------------------------------------------------------------------------
// the two rules — and they are deliberately two
// ---------------------------------------------------------------------------

/**
 * A hairline drawn as a FILLED one-pixel box: `h-hairline` becomes
 * `height-request: 1` and `bg-line` becomes one CSS declaration.
 */
export function HairlineRule({ className, testID }: Styleable) {
    return <View className={['w-full h-hairline bg-line', className]} testID={testID} />;
}

/**
 * The same rule drawn as a BORDER — and this is the interesting one.
 *
 * `border-t border-line` is the spelling a web-shaped design system reaches for
 * first, and L1 routes it faithfully: the generated class carries
 * `border-top-width: 1px` and `border-color`. GTK then draws nothing, because
 * `border-style` has no utility in this vocabulary and GTK's initial value is
 * `none`, which zeroes the width. MEASURED on GTK 4.22.4 and reported by the probe
 * as `ruleHeightPx`: the filled rule above measures 1px tall, this one measures 0.
 *
 * Kept in the showcase rather than deleted, because that is the difference between a
 * gap somebody can read off a run and a gap somebody rediscovers in a window.
 */
export function BorderRule({ className, testID }: Styleable) {
    return <View className={['w-full border-t border-line', className]} testID={testID} />;
}

// ---------------------------------------------------------------------------
// rail · section header · thumbnail · card · fields · scaffold
// ---------------------------------------------------------------------------

export interface RailEntry {
    readonly id: string;
    readonly label: string;
}

/** A vertical navigation rail: one column, a right-hand border, one active entry. */
export function Rail({
    entries,
    activeId,
    onSelect,
    testID,
}: {
    readonly entries: readonly RailEntry[];
    readonly activeId: string;
    readonly onSelect: (id: string) => void;
    readonly testID?: string;
}) {
    return (
        <View className="flex-col items-center gap-xs px-xs py-s bg-sunken border-r border-line" testID={testID}>
            {entries.map((entry) => (
                <Pressable
                    key={entry.id}
                    className={[
                        'rounded-md px-s py-xs active:opacity-80',
                        entry.id === activeId ? 'bg-surface' : 'bg-transparent',
                    ]}
                    onPress={() => onSelect(entry.id)}
                    testID={`rail-${entry.id}`}
                >
                    <Text
                        className={[
                            'text-caption font-bold uppercase tracking-wide',
                            entry.id === activeId ? 'text-accent' : 'text-muted',
                        ]}
                    >
                        {entry.label}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

/**
 * A section header: title, count, and trailing controls pushed to the far edge.
 *
 * The `flex-1` spacer is not a shortcut around `justify-between` — it is what L1's
 * refusal message asks for by name, and it is the only spelling that survives on a
 * `Gtk.Box`.
 */
export function SectionHeader({
    title,
    count,
    children,
    testID,
}: {
    readonly title: string;
    readonly count: number;
    readonly children?: ReactNode;
    readonly testID?: string;
}) {
    return (
        <View className="flex-row items-center gap-s px-m pt-m pb-s" testID={testID}>
            <Title>{title}</Title>
            <Badge testID="header-count">{String(count)}</Badge>
            <View className="flex-1" testID="header-spacer" />
            {children}
        </View>
    );
}

/**
 * A square tile with an optional flag pinned to its top-right corner.
 *
 * THE ONE ABSOLUTELY POSITIONED CHILD in the showcase, and it is authored the way
 * the measured application authors all five of its own: on the CHILD, never on the
 * element. That is what makes the tile a `Gtk.Overlay` at all — L2 reads the
 * children, sees one that declares `absolute`, and swaps the widget, moving
 * `orientation`/`spacing` into an inner box and leaving the padding, the size and
 * the generated class on the overlay where they still frame the whole tile.
 *
 * `top-2xs right-2xs` splits across BOTH channels by design: `top-*` becomes the
 * widget property `margin-top` and `right-*` becomes the CSS `margin-right`, because
 * GTK CSS has no logical margin and `Gtk.Widget` has no physical one. The alignment
 * that pins it to the corner (`halign: end`, `valign: start`) is derived from WHICH
 * edges were given — a `Gtk.Overlay` positions an overlay child by alignment and has
 * no coordinate pair to set.
 */
export function Thumbnail({
    initials,
    flag,
    testID,
}: {
    readonly initials: string;
    readonly flag?: string;
    readonly testID?: string;
}) {
    return (
        <View className="w-thumb h-thumb items-center rounded-md bg-sunken overflow-hidden" testID={testID}>
            <Text className="text-title font-bold text-muted mt-s">{initials}</Text>
            {flag === undefined ? null : (
                <View className="absolute top-2xs right-2xs rounded-pill bg-caution px-2xs" testID={`${testID}-flag`}>
                    <Text className="text-caption font-bold text-ink">{flag}</Text>
                </View>
            )}
        </View>
    );
}

/** A row of actions, hugging the trailing edge — `justify-end` is the box's own `halign`. */
export function ActionRow({ children, testID }: { readonly children: ReactNode; readonly testID?: string }) {
    return (
        <View className="flex-row items-center justify-end gap-s" testID={testID}>
            {children}
        </View>
    );
}

export interface CardItem {
    readonly id: string;
    readonly initials: string;
    readonly title: string;
    readonly summary: string;
    readonly tag: string;
    readonly meta: string;
    readonly state: 'open' | 'done';
    readonly flag?: string;
}

export function Card({
    item,
    onOpen,
    onDismiss,
}: {
    readonly item: CardItem;
    readonly onOpen?: () => void;
    readonly onDismiss?: () => void;
}) {
    return (
        <View className="flex-col gap-s rounded-lg border border-line bg-surface p-m" testID={`card-${item.id}`}>
            <View className="flex-row items-start gap-m">
                <Thumbnail initials={item.initials} flag={item.flag} testID={`thumb-${item.id}`} />
                <View className="flex-1 flex-col gap-2xs">
                    <Title>{item.title}</Title>
                    <Body lines={2} testID={`summary-${item.id}`}>
                        {item.summary}
                    </Body>
                    <View className="flex-row items-center gap-xs mt-2xs">
                        <Badge tone={item.state === 'done' ? 'positive' : 'accent'}>{item.tag}</Badge>
                        <Caption>{item.meta}</Caption>
                    </View>
                </View>
            </View>
            <HairlineRule className="mx-2xs" />
            <ActionRow testID={`actions-${item.id}`}>
                <Button variant="quiet" onPress={onDismiss} testID={`dismiss-${item.id}`}>
                    Dismiss
                </Button>
                <Button variant="primary" onPress={onOpen} testID={`open-${item.id}`}>
                    Open
                </Button>
            </ActionRow>
        </View>
    );
}

/**
 * A labelled single-line field. `multiline` would be a different widget entirely —
 * a `Gtk.TextView`, whose content lives in a `Gtk.TextBuffer` rather than in a
 * property, which is why four of `TextInput`'s props are refused by name there.
 *
 * CONTROLLED (`value`), which means the whole field re-renders per keystroke. That
 * is only affordable because a list-valued property can now be written after mount:
 * every styled node in the subtree rewrites its `css-classes` on every commit, and
 * `set_property` cannot store a `GStrv` at all.
 */
export function Field({
    label,
    value,
    placeholder,
    onChangeText,
    testID,
}: {
    readonly label: string;
    readonly value: string;
    readonly placeholder?: string;
    readonly onChangeText?: (text: string) => void;
    readonly testID?: string;
}) {
    return (
        <View className="flex-col gap-2xs">
            <Overline>{label}</Overline>
            <TextInput
                className="rounded-md border border-line bg-surface px-s py-2xs text-body text-ink"
                value={value}
                placeholder={placeholder}
                onChangeText={onChangeText}
                testID={testID}
            />
        </View>
    );
}

/** A caption beside a switch — the smallest settings row a design system needs. */
export function ToggleRow({
    label,
    value,
    onValueChange,
    testID,
}: {
    readonly label: string;
    readonly value: boolean;
    readonly onValueChange?: (next: boolean) => void;
    readonly testID?: string;
}) {
    return (
        <View className="flex-row items-center gap-xs">
            <Caption>{label}</Caption>
            <Switch value={value} onValueChange={onValueChange} testID={testID} />
        </View>
    );
}

/**
 * The busy indicator, and the mapping worth knowing before it surprises anyone:
 * `Adw.Spinner` installs no property that stops it (measured — all 36 of its
 * properties are `Gtk.Widget`'s), so `animating` becomes `visible`. A stopped
 * spinner here is a hidden one, which is also what `hidesWhenStopped` asks for.
 */
export function Busy({ animating, testID }: { readonly animating: boolean; readonly testID?: string }) {
    return <ActivityIndicator size="small" animating={animating} testID={testID} />;
}

/**
 * The screen scaffold: a column with a header, a scrolling body and a footer.
 *
 * The scroller carries `flex-1 h-full` rather than the scaffold — an element cannot
 * see its own parent, so `flex-1` on the ROOT of a React tree has no orientation to
 * resolve against and stays an unresolved intent. That is not a defect (guessing the
 * axis is what would be), but it is silent, so the expansion is authored one level
 * in where a parent exists.
 */
export function Screen({
    header,
    footer,
    children,
    testID,
}: {
    readonly header: ReactNode;
    readonly footer: ReactNode;
    readonly children: ReactNode;
    readonly testID?: string;
}) {
    return (
        <View className="flex-col bg-surface" testID={testID}>
            {header}
            <HairlineRule testID="rule-filled" />
            {children}
            <BorderRule testID="rule-border" />
            {footer}
        </View>
    );
}

/** The scrolling body. `contentContainerClassName` styles the INNER box, not the scroller. */
export function ScrollBody({
    dense,
    children,
    testID,
}: {
    readonly dense: boolean;
    readonly children: ReactNode;
    readonly testID?: string;
}) {
    return (
        <ScrollView
            className="flex-1 h-full"
            contentContainerClassName={['flex-col p-m', dense ? 'gap-s' : 'gap-m']}
            testID={testID}
        >
            {children}
        </ScrollView>
    );
}

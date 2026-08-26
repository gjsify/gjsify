// SPDX-License-Identifier: MIT
//
// One screen composed out of the design-system layer, and the only file here that
// holds state. Three pieces of it, chosen because each one is a DIFFERENT kind of
// update coming back from GTK through the reconciler:
//
//   filter   a `Pressable`'s `clicked`      → a class swap on two widgets, and a
//                                             shorter keyed list
//   query    a `Gtk.Entry`'s `notify::text` → the same list again, from the other
//                                             front end, plus a text-sink patch
//   dense    a `Gtk.Switch`'s `notify::active` → one widget PROPERTY, `Gtk.Box:spacing`
//
// The third is the one worth naming: `gap-s` versus `gap-m` is not CSS, so it proves
// the reconciler patched a property rather than swapped a stylesheet class. A screen
// that only ever changed colours could not tell the two apart — and one that only
// ever changed properties would have missed the `css-classes` defect this showcase
// found on its first run (a `GStrv` cannot be written through `set_property`; see
// `writeProperty` in `@gjsify/gtk-host`'s `host.ts`, which is the fix).

import { Text, View } from '@gjsify/react-native';
import { useCallback, useState } from 'react';

import {
    Busy,
    Button,
    Caption,
    Card,
    Chip,
    Display,
    Field,
    HairlineRule,
    Rail,
    ScrollBody,
    Screen,
    SectionHeader,
    ToggleRow,
} from './components.js';
import type { CardItem, RailEntry } from './components.js';

/**
 * Every callback the screen fires, in order.
 *
 * A module-level array rather than state, because it answers a different question:
 * state proves the tree changed, this proves the callback ran WITH THE RIGHT
 * ARGUMENT. `onValueChange(true)` and `onChangeText('quarry')` are only checkable
 * from here — the widget already held both values before the handler was called.
 */
export const fired: string[] = [];

/**
 * The rows. Fixed data rather than a generator, because the probe asserts COUNTS
 * after filtering and a generated list would make those assertions about the
 * generator instead.
 */
const ITEMS: readonly CardItem[] = [
    {
        id: 'atlas',
        initials: 'AT',
        title: 'Atlas',
        summary: 'A map of every surface the design system covers, kept beside the tokens it reads.',
        tag: 'Active',
        meta: 'updated today',
        state: 'open',
        flag: '2',
    },
    {
        id: 'beacon',
        initials: 'BE',
        title: 'Beacon',
        summary: 'Status transport for long-running work, with one subscriber per channel and no fan-out.',
        tag: 'Active',
        meta: 'updated yesterday',
        state: 'open',
    },
    {
        id: 'ledger',
        initials: 'LE',
        title: 'Ledger',
        summary: 'An append-only record of decisions, rendered as a list and exported as data.',
        tag: 'Shipped',
        meta: 'archived',
        state: 'done',
        flag: '1',
    },
    {
        id: 'quarry',
        initials: 'QU',
        title: 'Quarry',
        summary: 'Extraction jobs and their retries, grouped by the source they were read from.',
        tag: 'Shipped',
        meta: 'archived',
        state: 'done',
    },
];

const SECTIONS: readonly RailEntry[] = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'done', label: 'Done' },
];

const matches = (item: CardItem, section: string, query: string): boolean =>
    (section === 'all' || item.state === section) &&
    (query === '' || `${item.title} ${item.summary}`.toLowerCase().includes(query.toLowerCase()));

export function Catalogue() {
    const [section, setSection] = useState('all');
    const [query, setQuery] = useState('');
    const [dense, setDense] = useState(false);

    const visible = ITEMS.filter((item) => matches(item, section, query));

    const select = useCallback((id: string) => {
        fired.push(`section:${id}`);
        setSection(id);
    }, []);
    const search = useCallback((text: string) => {
        fired.push(`query:${text}`);
        setQuery(text);
    }, []);
    const compact = useCallback((next: boolean) => {
        fired.push(`dense:${String(next)}`);
        setDense(next);
    }, []);

    return (
        <Screen
            testID="screen"
            header={
                <SectionHeader title="Catalogue" count={visible.length} testID="header">
                    {SECTIONS.map((entry) => (
                        <Chip
                            key={entry.id}
                            selected={entry.id === section}
                            onPress={() => select(entry.id)}
                            testID={`chip-${entry.id}`}
                        >
                            {entry.label}
                        </Chip>
                    ))}
                </SectionHeader>
            }
            footer={
                <View className="flex-row items-end gap-m p-m" testID="footer">
                    <Field
                        label="Filter"
                        value={query}
                        placeholder="Search"
                        onChangeText={search}
                        testID="filter-field"
                    />
                    <ToggleRow label="Compact" value={dense} onValueChange={compact} testID="dense-switch" />
                    <Busy animating testID="busy-on" />
                    <Busy animating={query !== ''} testID="busy-query" />
                    <View className="flex-1" testID="footer-spacer" />
                    <Button variant="quiet" onPress={() => fired.push('reset')} testID="reset-button">
                        Reset
                    </Button>
                    <Button variant="primary" disabled testID="apply-button">
                        Applied
                    </Button>
                </View>
            }
        >
            <View className="flex-row h-full" testID="body">
                <Rail entries={SECTIONS} activeId={section} onSelect={select} testID="rail" />
                <ScrollBody dense={dense} testID="catalogue">
                    <Display testID="page-title">Catalogue</Display>
                    {visible.map((item) => (
                        <Card
                            key={item.id}
                            item={item}
                            onOpen={() => fired.push(`open:${item.id}`)}
                            onDismiss={() => fired.push(`dismiss:${item.id}`)}
                        />
                    ))}
                    <HairlineRule testID="rule-list-end" />
                    {/* A styled node whose only change is its TEXT, so the probe can
                        separate a text-sink patch from a class or property one. */}
                    <Caption className="text-center" testID="status-note">
                        {`${String(visible.length)} of ${String(ITEMS.length)} shown`}
                    </Caption>
                    <Text testID="hint">Press a chip, type a filter, flip the switch.</Text>
                </ScrollBody>
            </View>
        </Screen>
    );
}

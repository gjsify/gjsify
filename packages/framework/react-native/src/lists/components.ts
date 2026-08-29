// The four list components — and every one of them is the SAME component.
//
// `FlatList`, `SectionList`, `VirtualizedList` and `VirtualizedSectionList` differ in
// how they are handed their rows and in nothing else: `data`, `getItem`/`getItemCount`,
// or `sections`. ADR 0032 already says the useful subset of `VirtualizedList` is what
// backs `FlatList`; this file is that sentence as code, with `flatten*` doing the one
// thing each name does differently.
//
// THEY ARE NOT ORDINARY ELEMENTS, and `lists/controller.ts` holds the measurements
// that force it — a `Gtk.ListView` installs no child-adding method at all, a
// `Gtk.ListItem` is not a `Gtk.Widget`, and rows bind the moment the view is rooted in
// a window. So the component owns its `Gtk.ListView`, drives the model imperatively
// from `data`, and the React tree lives only inside the item factory.
//
// WHAT IS STILL AN ELEMENT is the frame: L2's `FlatList` row is an outer `Gtk.Box` and
// an inner `Gtk.ScrolledWindow`, which is where `style`, `className`, `horizontal` and
// the scrollbar policies land through the ordinary routes. The `Gtk.ListView` itself is
// an element too — the host creates it and places it in the scroller — it just never
// gets a React child.
//
// THE HEADER AND FOOTER ARE OUTSIDE THE SCROLLER, and it is a declared limit rather
// than a shortcut. MEASURED on gtk 4.22.4 with a 500-row model in a presented 400×300
// window: with the list as the scroller's own child, `sw.get_child()` is the
// `Gtk.ListView` and the adjustment's `upper` is 11 000 — the list is the scrollable and
// GTK's own `Gtk.Scrollable` path is in use. Wrapped in a `Gtk.Box` with a header,
// `sw.get_child()` becomes a `GtkViewport`, the adjustment's `upper` becomes 11 018 and
// the list is allocated its whole 11 000 px content height while still realising only
// 205 of the 500 rows — i.e. rows outside the realised range have no widget while
// sitting inside the allocated area. Keeping the list as the scroller's own child is
// the arrangement `Gtk.Scrollable` exists for, so the header and footer are siblings of
// the scroller and stay put while the rows scroll.
//
// No `gi://` import and no `@girs/*` import: every widget name comes from L2, the
// `Gtk.ListView` reaches the controller as an opaque ref, and the controller owns the
// toolkit. The same shape `components.ts` has, and the reason both are
// `node: "polyfill"` clean.

import { createElement, useEffect, useRef, type ComponentType, type ReactElement, type ReactNode } from 'react';

import { createListController, onScrollNearEnd, rowKey, type ListRow, type ReactListController } from './controller.js';
import { nodeProps, usePlan, type CommonProps, type Rendered } from '../components.js';
import { ParentProvider } from '../parent-context.js';
import { PrimitiveError } from '../primitives/errors.js';

/** What React Native's `renderItem` receives. */
export interface ListRenderItemInfo<T> {
    readonly item: T;
    readonly index: number;
    readonly separators: ListSeparators;
}

/**
 * React Native's `separators`, refusing all three of its methods by name.
 *
 * They ask the list to restyle the separator above and below a row — and a
 * `Gtk.ListView` has no separator widget to restyle: `show-separators` makes GTK draw
 * the Adwaita line itself, between rows it owns. `ItemSeparatorComponent` is refused in
 * the table for the same reason, so this is that refusal reaching the one other place
 * it can be asked for.
 */
export interface ListSeparators {
    highlight(): void;
    unhighlight(): void;
    updateProps(select: 'leading' | 'trailing', newProps: object): void;
}

const NO_SEPARATORS =
    'restyles the separator around a row, and a `Gtk.ListView` has no separator widget to restyle — `Gtk.ListView:show-separators` makes GTK draw the Adwaita line itself, between rows it owns. Give the row its own border instead (`border-b`), which is a real widget property you can change';

const SEPARATORS: ListSeparators = {
    highlight(): never {
        throw new PrimitiveError('FlatList', 'separators.highlight', NO_SEPARATORS);
    },
    unhighlight(): never {
        throw new PrimitiveError('FlatList', 'separators.unhighlight', NO_SEPARATORS);
    },
    updateProps(): never {
        throw new PrimitiveError('FlatList', 'separators.updateProps', NO_SEPARATORS);
    },
};

/** A header/footer/empty slot: an element, or a component to render. */
export type ListSlot = ReactNode | ComponentType<Record<string, never>>;

/** The props every list in this file answers for. Each name is in L2's row. */
export interface ListFrameProps extends Omit<CommonProps, 'children'> {
    /**
     * Where a ROW's own render error goes. Not a React Native prop, and it earns its
     * place: a row is a React root of its own, so an error inside `renderItem` has no
     * ancestor boundary in the outer tree to reach. Absent means the host's default —
     * logged and rethrown, which is loud.
     */
    onRowError?: (error: Error) => void;
    horizontal?: boolean;
    showsVerticalScrollIndicator?: boolean;
    showsHorizontalScrollIndicator?: boolean;
    ListEmptyComponent?: ListSlot;
    ListHeaderComponent?: ListSlot;
    ListFooterComponent?: ListSlot;
    onEndReached?: (info: { distanceFromEnd: number }) => void;
    /** Page-lengths from the end at which `onEndReached` fires. React Native's default is 0.5. */
    onEndReachedThreshold?: number;
    /** A change re-renders every bound row, for the rows whose keys did not change. */
    extraData?: unknown;
}

export interface FlatListProps<T> extends ListFrameProps {
    data?: readonly T[] | null;
    renderItem?: (info: ListRenderItemInfo<T>) => ReactNode;
    keyExtractor?: (item: T, index: number) => string;
}

export interface VirtualizedListProps<T> extends FlatListProps<T> {
    /** `VirtualizedList`'s accessor form of `data` — three lines here, and honest. */
    getItem?: (data: readonly T[] | null | undefined, index: number) => T;
    getItemCount?: (data: readonly T[] | null | undefined) => number;
}

export interface SectionListSection<T> {
    readonly data: readonly T[];
    readonly key?: string;
    readonly title?: string;
}

export interface SectionListProps<T> extends ListFrameProps {
    sections?: readonly SectionListSection<T>[];
    renderItem?: (info: ListRenderItemInfo<T>) => ReactNode;
    renderSectionHeader?: (info: { section: SectionListSection<T> }) => ReactNode;
    keyExtractor?: (item: T, index: number) => string;
}

/** A slot → what to render for it. React Native accepts an element or a component. */
function slot(value: ListSlot): ReactNode {
    if (typeof value === 'function') return createElement(value as ComponentType<Record<string, never>>, {});
    return value ?? null;
}

/**
 * The shared body: a frame, a controller, and the rows the caller worked out.
 *
 * The three effects are declared in the order they must run — attach, then rows, then
 * the end-of-list watch — because React runs effects in declaration order and the model
 * has to exist before it can be filled.
 */
function useListFrame(
    primitive: string,
    props: object,
    rows: readonly ListRow[],
    rowsKey: string,
    isEmpty: boolean,
    onRowError?: (error: Error) => void,
): {
    readonly rendered: Rendered;
    readonly listRef: (widget: unknown) => void;
    readonly scrollerRef: (widget: unknown) => void;
} {
    const frameProps = props as ListFrameProps & Record<string, unknown>;
    const rendered = usePlan(primitive, props);
    const view = useRef<unknown>(null);
    const scroller = useRef<unknown>(null);
    const controller = useRef<ReactListController | null>(null);
    const latestRows = useRef(rows);
    latestRows.current = rows;

    // 1. The controller lives as long as the `Gtk.ListView` does — which is as long as
    //    the list is non-empty, because an empty list renders its `ListEmptyComponent`
    //    INSTEAD of the scroller and the view is gone. `isEmpty` is therefore a real
    //    dependency: the effect tears the controller down and builds a new one, which
    //    is right, because the old one was attached to a widget React destroyed.
    useEffect(() => {
        const widget = view.current;
        if (isEmpty || widget === null || widget === undefined) return;
        const owned = createListController(onRowError === undefined ? {} : { onRowError });
        controller.current = owned;
        owned.attach(widget as Parameters<ReactListController['attach']>[0]);
        owned.setRows(latestRows.current);
        return () => {
            controller.current = null;
            // The AUTHORITY on teardown. GTK's own `teardown` signal fires when the
            // view is collected, and GJS blocks a JS callback during GC sweeping
            // (measured — `lists/controller.ts` has the six criticals). So every row's
            // React root is unmounted here, while callbacks still work.
            owned.dispose();
        };
    }, [isEmpty]);

    // 2. The rows. `rowsKey` covers an identity change; `data`, `extraData` and
    //    `renderItem` cover a CONTENT change behind unchanged keys, which GTK will not
    //    re-bind for us (measured: `items_changed` over the same object does nothing).
    useEffect(() => {
        controller.current?.setRows(latestRows.current);
    }, [rowsKey, frameProps.data, frameProps.sections, frameProps.extraData, frameProps.renderItem]);

    // 3. The end of the list, from the scroller's own adjustment.
    const threshold = frameProps.onEndReachedThreshold ?? 0.5;
    const axis = frameProps.horizontal === true ? 'horizontal' : 'vertical';
    const onEndReached = frameProps.onEndReached;
    useEffect(() => {
        const widget = scroller.current;
        if (onEndReached === undefined || widget === null || widget === undefined) return;
        return onScrollNearEnd(widget as Parameters<typeof onScrollNearEnd>[0], axis, threshold, (distanceFromEnd) =>
            onEndReached({ distanceFromEnd }),
        );
    }, [onEndReached, axis, threshold, isEmpty]);

    return {
        rendered,
        listRef: (widget: unknown) => {
            view.current = widget;
        },
        scrollerRef: (widget: unknown) => {
            scroller.current = widget;
        },
    };
}

/** The frame's element tree: `[header, scroller > list, footer]`, or the empty slot. */
function renderFrame(
    frame: ReturnType<typeof useListFrame>,
    props: ListFrameProps,
    isEmpty: boolean,
    horizontal: boolean,
): ReactElement {
    const { rendered, listRef, scrollerRef } = frame;
    const { plan, inherited, extra, contentExtra, published } = rendered;
    if (plan.content === null) {
        throw new PrimitiveError(
            plan.primitive,
            '',
            'has no content node, so there is no scroller to put the list in — the primitive table is wrong, not the call',
        );
    }
    const wrap = (node: ReactNode, key: string): ReactNode =>
        node === null ? null : createElement(ParentProvider, { value: published, key }, node);

    const body = isEmpty
        ? wrap(slot(props.ListEmptyComponent), 'empty')
        : createElement(
              plan.content.tag,
              { ...nodeProps(plan.content, {}, contentExtra), key: 'scroller', ref: scrollerRef },
              // The list is the scroller's OWN child, which is what keeps GTK's
              // `Gtk.Scrollable` path in use — see the header measurement.
              createElement('GtkListView', {
                  ref: listRef,
                  ...(horizontal ? { orientation: 'horizontal' } : {}),
              }),
          );

    return createElement(
        plan.node.tag,
        nodeProps(plan.node, inherited, extra),
        wrap(slot(props.ListHeaderComponent), 'header'),
        body,
        wrap(slot(props.ListFooterComponent), 'footer'),
    );
}

/** `data` (or `getItem`/`getItemCount`) → the rows, keyed React Native's way. */
function flattenData<T>(props: VirtualizedListProps<T>): { readonly rows: ListRow[]; readonly rowsKey: string } {
    const data = props.data ?? null;
    const count = props.getItemCount === undefined ? (data?.length ?? 0) : props.getItemCount(data);
    const at = (index: number): T =>
        props.getItem === undefined ? ((data as readonly T[])[index] as T) : props.getItem(data, index);
    const rows: ListRow[] = [];
    for (let index = 0; index < count; index++) {
        const key = rowKey(
            at(index),
            index,
            props.keyExtractor as ((item: unknown, index: number) => string) | undefined,
        );
        rows.push({
            key,
            // Reads `props` at BIND time, not at render time: a bind happens on a
            // microtask after the commit, and for a row whose key did not change it can
            // happen many renders later. Closing over the value would show the data the
            // row had when its key was first seen.
            render: () => renderOne(props.renderItem, at(index), index),
        });
    }
    return { rows, rowsKey: rows.map((row) => row.key).join('\0') };
}

/** `sections` → header rows and item rows in ONE model. */
function flattenSections<T>(props: SectionListProps<T>): { readonly rows: ListRow[]; readonly rowsKey: string } {
    const rows: ListRow[] = [];
    (props.sections ?? []).forEach((section, sectionIndex) => {
        const sectionKey = section.key ?? section.title ?? `section-${sectionIndex}`;
        if (props.renderSectionHeader !== undefined) {
            rows.push({
                key: `header:${sectionKey}`,
                render: () => props.renderSectionHeader?.({ section }) ?? null,
            });
        }
        section.data.forEach((item, index) => {
            const key = rowKey(
                item,
                index,
                props.keyExtractor as ((item: unknown, index: number) => string) | undefined,
            );
            rows.push({ key: `${sectionKey}:${key}`, render: () => renderOne(props.renderItem, item, index) });
        });
    });
    return { rows, rowsKey: rows.map((row) => row.key).join('\0') };
}

/**
 * One row's tree, or a named refusal.
 *
 * A missing `renderItem` is refused rather than rendered as nothing: React Native's own
 * `FlatList` requires it, and a list of correctly sized empty rows is the exact shape of
 * failure this layer exists to remove.
 */
function renderOne<T>(
    renderItem: ((info: ListRenderItemInfo<T>) => ReactNode) | undefined,
    item: T,
    index: number,
): ReactNode {
    if (renderItem === undefined) {
        throw new PrimitiveError(
            'FlatList',
            'renderItem',
            'was not given, so there is nothing to put in a row. React Native requires it too — and a list of empty rows is exactly the silent failure this layer refuses',
        );
    }
    return renderItem({ item, index, separators: SEPARATORS });
}

export function FlatList<T>(props: FlatListProps<T>): ReactElement {
    const { rows, rowsKey } = flattenData(props as VirtualizedListProps<T>);
    const isEmpty = rows.length === 0 && props.ListEmptyComponent !== undefined;
    const frame = useListFrame('FlatList', props, rows, rowsKey, isEmpty, props.onRowError);
    return renderFrame(frame, props, isEmpty, props.horizontal === true);
}

/**
 * `VirtualizedList`, as the honest subset ADR 0032 asks for.
 *
 * Its own public surface is wide and most of it configures React Native's
 * virtualisation, which `Gtk.ListView` does itself — those props are refused by name in
 * L2's row. What is left is a real API and three lines: `getItemCount(data)` for the
 * length and `getItem(data, i)` for a row, which is `FlatList` with the array
 * behind an accessor.
 */
export function VirtualizedList<T>(props: VirtualizedListProps<T>): ReactElement {
    const { rows, rowsKey } = flattenData(props);
    const isEmpty = rows.length === 0 && props.ListEmptyComponent !== undefined;
    const frame = useListFrame('FlatList', props, rows, rowsKey, isEmpty, props.onRowError);
    return renderFrame(frame, props, isEmpty, props.horizontal === true);
}

/**
 * `SectionList`, with the sections FLATTENED into one model.
 *
 * MEASURED on gtk 4.22.4: GTK does have section models — `Gtk.SectionModel` exists,
 * `Gtk.FlattenListModel` and every selection model implement it (`Gio.ListStore` and
 * `Gtk.StringList` do not), `Gtk.ListView.set_header_factory` is there, and a
 * `Gtk.FlattenListModel` over two stores answered `get_section(0) = [0, 2]`. So the
 * sticky-header route is real and available.
 *
 * It is not the one taken, and the reason is what the sticky route costs: a second
 * factory with its own React roots, a `Gtk.ListHeader` whose `start`/`end`/`n-items`
 * have to be reconciled with React Native's `section` object, and a model of models
 * whose splice semantics are one level deeper than the flat one. A flattened model with
 * header ROWS is one model, one factory and one splice — and it delivers exactly what
 * `stickySectionHeadersEnabled={false}` asks for, which is the support table's declared
 * limit. The measurement is written down here so the sticky version is an upgrade with
 * a known starting point rather than a rediscovery.
 */
export function SectionList<T>(props: SectionListProps<T>): ReactElement {
    const { rows, rowsKey } = flattenSections(props);
    const isEmpty = rows.length === 0 && props.ListEmptyComponent !== undefined;
    const frame = useListFrame('FlatList', props, rows, rowsKey, isEmpty, props.onRowError);
    return renderFrame(frame, props, isEmpty, props.horizontal === true);
}

/** The section-shaped sibling of `VirtualizedList`, which is `SectionList` here. */
export function VirtualizedSectionList<T>(props: SectionListProps<T>): ReactElement {
    return SectionList(props);
}

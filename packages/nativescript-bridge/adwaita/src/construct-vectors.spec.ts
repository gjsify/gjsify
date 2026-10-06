// ADR 0093: this port's `./capabilities` table held to `CONSTRUCT_VECTORS` through its real
// tree builder. On the TREES entry for the reason `grid-layout.spec.ts` gives.

import {
    BREAKPOINT_VECTOR_SIZES,
    CONSTRUCT_VECTORS,
    EXTERN_VECTOR_CLASS,
    driveConstructVectors,
    type ConstructVector,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { applyBreakpoints, build, buildDialog, buildWithSiblings, registerTemplateClass } from './builder/index.js';
import { capabilities } from './capabilities.js';
import { GtkBox } from './widgets/gtk-box.js';
import type { GtkButton } from './widgets/gtk-button.js';
import type { AdwAlertDialog } from './widgets/adw-alert-dialog.js';
import type { AdwComboRow } from './widgets/adw-combo-row.js';

type Cell = { row: number; column: number; columnSpan: number };

class CorpusExtern extends GtkBox {}
registerTemplateClass(EXTERN_VECTOR_CLASS, CorpusExtern);

function observe(vector: ConstructVector): unknown {
    switch (vector.kind) {
        case 'layout': {
            const root = build(vector.tree) as unknown as { getViewById(id: string): Cell };
            return ['a', 'b'].map((id) => {
                const { row, column, columnSpan } = root.getViewById(id);
                return { row, column, columnSpan };
            });
        }
        case 'strings':
            return (build(vector.tree) as unknown as Pick<AdwComboRow, 'model'>).model.map((option) => option.label);
        case 'responses':
            return (buildDialog(vector.tree) as unknown as AdwAlertDialog).responses.map(
                ({ id, label, appearance, enabled }) => ({ id, label, appearance, enabled }),
            );
        case 'signal': {
            let calls = 0;
            const root = build(vector.tree, {
                scope: {
                    onClicked: () => {
                        calls++;
                    },
                },
            }) as unknown as { getViewById(id: string): GtkButton };
            root.getViewById('pressed').notify({ eventName: 'clicked', object: root.getViewById('pressed') });
            return [{ handler: 'onClicked', calls }];
        }
        case 'bind': {
            const root = build(vector.tree) as unknown as {
                getViewById(id: string): { active: boolean };
            };
            const source = root.getViewById('source');
            const target = root.getViewById('target');
            const afterBuild = target.active;
            source.active = true;
            return { afterBuild, afterSourceOn: target.active };
        }
        case 'breakpoint': {
            let feed: ((size: { width: number; height: number }) => void) | undefined;
            const root = build(vector.tree, {
                observeSize: (_view, onSize) => {
                    feed = onSize;
                    return () => {};
                },
            }) as unknown as { getViewById(id: string): { label: string } };
            return BREAKPOINT_VECTOR_SIZES.map((size) => {
                feed!(size);
                return root.getViewById('caption').label;
            });
        }
        case 'sibling-object': {
            let feed: ((size: { width: number; height: number }) => void) | undefined;
            const { root, siblings } = buildWithSiblings(vector.tree, {
                observeSize: (_view, onSize) => {
                    feed = onSize;
                    return () => {};
                },
            });
            const beside = siblings.get('beside') as unknown as { label: string; parent?: unknown };
            const inside = (root as unknown as { getViewById(id: string): object | undefined }).getViewById('beside');
            return {
                insideRoot: inside !== undefined || beside.parent != null,
                label: BREAKPOINT_VECTOR_SIZES.map((size) => {
                    feed!(size);
                    return beside.label;
                }),
            };
        }
        case 'extern': {
            const root = build(vector.tree) as unknown as { getViewById(id: string): object | undefined };
            return [
                { id: 'registered', builtByRegisteredClass: root.getViewById('registered') instanceof CorpusExtern },
            ];
        }
        case 'page':
            // Refused, so the driver never asks for a reading; building must throw.
            build(vector.tree);
            return undefined;
    }
}

export const AdwConstructVectorsNsTest = async () => {
    await driveConstructVectors(
        { name: 'adwaita-nativescript', capabilities, vectors: CONSTRUCT_VECTORS, observe },
        { describe, it, expect },
    );
    await describe('adwaita-nativescript: template classes (ADR 0093)', async () => {
        await it('refuses an extern name nothing registered, naming it', () => {
            expect(() => build({ tag: 'GtkBox', children: [{ tag: 'NobodyRegisteredThis', extern: true }] })).toThrow(
                "'$NobodyRegisteredThis'",
            );
        });
        await it('refuses a second class under a registered name', () => {
            expect(() => registerTemplateClass(EXTERN_VECTOR_CLASS, class extends GtkBox {})).toThrow(
                'already registered',
            );
        });
        await it('refuses a signal handler the scope lacks, naming it', () => {
            const tree = CONSTRUCT_VECTORS.find((each) => each.kind === 'signal')!.tree;
            expect(() => build(tree)).toThrow("'onClicked'");
            expect(() => build(tree, { scope: {} })).toThrow('has no such function');
        });
        await it('refuses a signal the class does not emit, and the forms it has not verified', () => {
            const on = (signal: NonNullable<SharedTreeNode['signals']>[number]): SharedTreeNode => ({
                tag: 'GtkBox',
                children: [{ tag: 'GtkButton', signals: [signal] }],
            });
            const scope = { onX: () => {} };
            expect(() => build(on({ name: 'map', handler: 'onX' }), { scope })).toThrow("no signal 'map'");
            expect(() => build(on({ name: 'clicked', handler: 'onX', flags: ['swapped'] }), { scope })).toThrow(
                'plain handlers only',
            );
        });
        await it('refuses a bind to an id nothing has, to a source that emits no notify, and the flags', () => {
            const bound = (binding: NonNullable<SharedTreeNode['bindings']>[string], sourceTag = 'GtkToggleButton') =>
                ({
                    tag: 'GtkBox',
                    children: [
                        { tag: sourceTag, id: 'source' },
                        { tag: 'GtkToggleButton', bindings: { active: binding } },
                    ],
                }) as SharedTreeNode;
            expect(() => build(bound({ source: 'nobody', property: 'active' }))).toThrow("id 'nobody'");
            expect(() => build(bound({ source: 'template', property: 'active' }))).toThrow("id 'template'");
            expect(() => build(bound({ source: 'source', property: 'active' }, 'GtkLabel'))).toThrow(
                "does not emit 'notify::active'",
            );
            expect(() => build(bound({ source: 'source', property: 'active', flags: ['inverted'] }))).toThrow(
                'plain form only',
            );
        });
        await it('refuses a breakpoint setter that names no object or no property, and a condition nobody can read', () => {
            const withBreakpoint = (object: string, property = 'label', condition = 'max-width: 400px') =>
                ({
                    tag: 'GtkBox',
                    children: [{ tag: 'GtkLabel', id: 'caption' }],
                    breakpoints: [{ condition, setters: [{ object, property, value: 'x' }] }],
                }) as SharedTreeNode;
            expect(() => build(withBreakpoint('nobody'))).toThrow("id 'nobody'");
            expect(() => build(withBreakpoint('template'))).toThrow("id 'template'");
            expect(() => build(withBreakpoint('caption', 'no-such-property'))).toThrow("declares no 'noSuchProperty'");
            expect(() => build(withBreakpoint('caption', 'label', 'wide please'))).toThrow('breakpoint condition');
        });
        await it('applies breakpoints to views the application built itself', () => {
            const root = build({
                tag: 'GtkBox',
                children: [{ tag: 'GtkLabel', id: 'caption', props: { label: 'wide' } }],
            }) as unknown as {
                getViewById(id: string): { label: string };
            };
            let feed: ((size: { width: number; height: number }) => void) | undefined;
            applyBreakpoints(
                root as never,
                [
                    {
                        condition: 'max-width: 400px',
                        setters: [{ object: 'caption', property: 'label', value: 'narrow' }],
                    },
                ],
                { caption: root.getViewById('caption') as never },
                {
                    observeSize: (_view, onSize) => {
                        feed = onSize;
                        return () => {};
                    },
                },
            );
            feed!({ width: 300, height: 600 });
            expect(root.getViewById('caption').label).toBe('narrow');
            feed!({ width: 900, height: 600 });
            expect(root.getViewById('caption').label).toBe('wide');
            expect(() =>
                applyBreakpoints(
                    root as never,
                    [{ condition: 'max-width: 400px', setters: [{ object: 'x', property: 'label', value: 'y' }] }],
                    {},
                ),
            ).toThrow("id 'x'");
        });
        await it('hands a sibling back by id, a dialog included, and builds none of them into the root', () => {
            const tree: SharedTreeNode = {
                tag: 'AdwApplicationWindow',
                template: 'Shell',
                children: [{ tag: 'GtkLabel', id: 'inside' }],
                siblings: [
                    { tag: 'AdwAlertDialog', id: 'confirm', props: { heading: 'Save?' } },
                    { tag: EXTERN_VECTOR_CLASS, extern: true, id: 'screen' },
                ],
            };
            const { root, siblings } = buildWithSiblings(tree);
            expect([...siblings.keys()].join()).toBe('confirm,screen');
            expect(siblings.get('screen') instanceof CorpusExtern).toBe(true);
            expect((siblings.get('confirm') as unknown as AdwAlertDialog).heading).toBe('Save?');
            expect((root as unknown as { getViewById(id: string): object | undefined }).getViewById('screen')).toBe(
                undefined,
            );
        });
        await it('refuses siblings through build and buildDialog, a sibling without an id, and a duplicate id', () => {
            const withSiblings = (siblings: SharedTreeNode[]): SharedTreeNode => ({
                tag: 'GtkBox',
                children: [{ tag: 'GtkLabel', id: 'taken' }],
                siblings,
            });
            const labelled = withSiblings([{ tag: 'GtkLabel', id: 'beside' }]);
            expect(() => build(labelled)).toThrow('buildWithSiblings');
            expect(() => buildDialog(labelled)).toThrow('buildWithSiblings');
            expect(() => buildWithSiblings(withSiblings([{ tag: 'GtkLabel' }]))).toThrow('has no id');
            expect(() => buildWithSiblings(withSiblings([{ tag: 'GtkLabel', id: 'taken' }]))).toThrow("id 'taken'");
        });
        await it('refuses a breakpoint setter that names a sibling the tree does not carry', () => {
            const tree = CONSTRUCT_VECTORS.find((each) => each.kind === 'sibling-object')!.tree;
            expect(() => buildWithSiblings({ ...tree, siblings: [] })).toThrow("id 'beside'");
        });
        await it('builds the registered class with its own props and children, as for any widget', () => {
            const root = build({
                tag: 'GtkBox',
                children: [
                    { tag: EXTERN_VECTOR_CLASS, extern: true, id: 'e', children: [{ tag: 'GtkLabel', id: 'inner' }] },
                ],
            }) as unknown as { getViewById(id: string): object | undefined };
            expect(root.getViewById('e') instanceof CorpusExtern).toBe(true);
            expect(root.getViewById('inner') !== undefined).toBe(true);
        });
    });
};

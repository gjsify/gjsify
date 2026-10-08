// ADR 0093: this renderer's `./capabilities` table held to `CONSTRUCT_VECTORS` through the real
// tree builder and the elements it mounts.

import {
    BREAKPOINT_VECTOR_SIZES,
    CONSTRUCT_VECTORS,
    EXTERN_VECTOR_CLASS,
    driveConstructVectors,
    type ConstructVector,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import type { AdwAlertDialog } from './elements/adw-alert-dialog.js';
import { capabilities } from './capabilities.mjs';
import { buildSharedTree, mountSharedTree } from './shared-tree-builder.js';
import { registerTemplateClass } from './template-classes.js';

const vector = (kind: string) => CONSTRUCT_VECTORS.find((each) => each.kind === kind)!.tree;

class CorpusExtern extends HTMLElement {}
customElements.define('corpus-extern', CorpusExtern);
registerTemplateClass(EXTERN_VECTOR_CLASS, 'corpus-extern');

function observe(vector: ConstructVector): unknown {
    if (vector.kind === 'layout' || vector.kind === 'sibling-object') {
        buildSharedTree(vector.tree);
        return undefined;
    }
    if (vector.kind === 'page') {
        const stack = buildSharedTree(vector.tree);
        return [{ name: stack.children[0]!.getAttribute('name'), title: stack.children[0]!.getAttribute('title') }];
    }
    if (vector.kind === 'signal') {
        let calls = 0;
        const { root, unmount } = mountSharedTree(vector.tree, {
            scope: {
                onClicked: () => {
                    calls++;
                },
            },
        });
        try {
            root.querySelector('#pressed')!.dispatchEvent(new Event('click'));
            return [{ handler: 'onClicked', calls }];
        } finally {
            unmount();
        }
    }
    if (vector.kind === 'bind') {
        const { root, unmount } = mountSharedTree(vector.tree);
        try {
            const source = root.querySelector('#source') as unknown as { active: boolean };
            const target = root.querySelector('#target') as unknown as { active: boolean };
            const afterBuild = target.active;
            source.active = true;
            return { afterBuild, afterSourceOn: target.active };
        } finally {
            unmount();
        }
    }
    if (vector.kind === 'breakpoint') {
        let feed: ((size: { width: number; height: number }) => void) | undefined;
        const { root, unmount } = mountSharedTree(vector.tree, {
            observeSize: (_element, onSize) => {
                feed = onSize;
                return () => {};
            },
        });
        try {
            return BREAKPOINT_VECTOR_SIZES.map((size) => {
                feed!(size);
                return root.querySelector('#caption')!.getAttribute('label');
            });
        } finally {
            unmount();
        }
    }
    if (vector.kind === 'extern') {
        return [...buildSharedTree(vector.tree).children].map((child) => ({
            id: child.id,
            builtByRegisteredClass: child instanceof CorpusExtern,
        }));
    }
    const { root, unmount } = mountSharedTree(vector.tree);
    try {
        if (vector.kind === 'strings') {
            return [...root.querySelectorAll('option, .adw-drop-down-item-label')].map((node) => node.textContent);
        }
        const dialog = root as unknown as AdwAlertDialog;
        return (vector.tree.extensions?.responses ?? []).map(({ id }) => ({
            id,
            label: dialog.getResponseLabel(id),
            appearance: dialog.getResponseAppearance(id),
            enabled: dialog.getResponseEnabled(id),
        }));
    } finally {
        unmount();
    }
}

export const AdwConstructVectorsTest = async () => {
    await driveConstructVectors(
        { name: 'adwaita-web', capabilities, vectors: CONSTRUCT_VECTORS, observe },
        { describe, it, expect },
    );
    await describe('adwaita-web: template classes and handlers (ADR 0093)', async () => {
        await it('refuses an extern name nothing registered, naming it', () => {
            expect(() =>
                buildSharedTree({ tag: 'GtkBox', children: [{ tag: 'NobodyRegisteredThis', extern: true }] }),
            ).toThrow("'$NobodyRegisteredThis'");
        });
        await it('refuses a second tag under a registered name', () => {
            expect(() => registerTemplateClass(EXTERN_VECTOR_CLASS, 'corpus-extern-two')).toThrow('already registered');
        });
        await it('refuses a registered tag nothing defined, naming it', () => {
            registerTemplateClass('CorpusUndefinedTag', 'corpus-undefined-tag');
            expect(() =>
                buildSharedTree({ tag: 'GtkBox', children: [{ tag: 'CorpusUndefinedTag', extern: true }] }),
            ).toThrow('nothing has defined');
        });
        await it('refuses a signal handler the scope lacks, naming it', () => {
            const tree = vector('signal');
            expect(() => mountSharedTree(tree)).toThrow("'onClicked'");
            expect(() => mountSharedTree(tree, { scope: {} })).toThrow('has no such function');
        });
        await it('refuses a signal the element does not declare, and the forms it has not verified', () => {
            const on = (signal: NonNullable<SharedTreeNode['signals']>[number]): SharedTreeNode => ({
                tag: 'GtkBox',
                children: [{ tag: 'GtkButton', signals: [signal] }],
            });
            const scope = { onX: () => {} };
            expect(() => mountSharedTree(on({ name: 'map', handler: 'onX' }), { scope })).toThrow("no signal 'map'");
            expect(() => mountSharedTree(on({ name: 'clicked', handler: 'onX', flags: ['after'] }), { scope })).toThrow(
                'plain handlers only',
            );
            expect(() => mountSharedTree(on({ name: 'clicked', handler: 'onX', object: 'a' }), { scope })).toThrow(
                'plain handlers only',
            );
        });
        await it('runs a CheckButton `toggled` handler on a click and on a programmatic change', () => {
            let calls = 0;
            const { root, unmount } = mountSharedTree(
                {
                    tag: 'GtkBox',
                    children: [
                        { tag: 'GtkCheckButton', id: 'box', signals: [{ name: 'toggled', handler: 'onToggled' }] },
                    ],
                },
                { scope: { onToggled: () => calls++ } },
            );
            try {
                const box = root.querySelector('#box') as unknown as HTMLElement & { active: boolean };
                box.click();
                expect(box.active).toBe(true);
                box.active = false;
                expect(calls).toBe(2);
            } finally {
                unmount();
            }
        });
        await it('makes a bind follow a CheckButton `active`', () => {
            const { root, unmount } = mountSharedTree({
                tag: 'GtkBox',
                children: [
                    { tag: 'GtkCheckButton', id: 'box' },
                    {
                        tag: 'GtkToggleButton',
                        id: 'target',
                        bindings: { active: { source: 'box', property: 'active' } },
                    },
                ],
            });
            try {
                const target = root.querySelector('#target') as unknown as { active: boolean };
                expect(target.active).toBe(false);
                (root.querySelector('#box') as HTMLElement).click();
                expect(target.active).toBe(true);
            } finally {
                unmount();
            }
        });
        await it('makes a bind follow a Switch `active`', () => {
            const { root, unmount } = mountSharedTree({
                tag: 'GtkBox',
                children: [
                    { tag: 'GtkSwitch', id: 'source' },
                    { tag: 'GtkSwitch', id: 'target', bindings: { active: { source: 'source', property: 'active' } } },
                ],
            });
            try {
                const target = root.querySelector('#target') as unknown as { active: boolean };
                (root.querySelector('#source') as unknown as { active: boolean }).active = true;
                expect(target.active).toBe(true);
            } finally {
                unmount();
            }
        });
        await it('runs an Entry `changed` and `notify::text` handler on typing and on a programmatic set', () => {
            const seen: string[] = [];
            const { root, unmount } = mountSharedTree(
                {
                    tag: 'GtkBox',
                    children: [
                        {
                            tag: 'GtkEntry',
                            id: 'entry',
                            signals: [
                                { name: 'changed', handler: 'onChanged' },
                                { name: 'notify::text', handler: 'onText' },
                            ],
                        },
                    ],
                },
                { scope: { onChanged: () => seen.push('changed'), onText: () => seen.push('notify::text') } },
            );
            try {
                const entry = root.querySelector('#entry') as unknown as HTMLElement & {
                    text: string;
                    input: HTMLInputElement;
                };
                entry.input.value = 'typed';
                entry.input.dispatchEvent(new Event('input'));
                entry.text = 'set';
                entry.text = 'set';
                expect(seen.join()).toBe('changed,notify::text,changed,notify::text');
            } finally {
                unmount();
            }
        });
        await it('dispatches ViewStack `notify::visible-child-name` when the visible page changes', () => {
            const stack = document.createElement('adw-view-stack') as HTMLElement & {
                addTitled(c: HTMLElement, name: string, title: string): unknown;
                visibleChildName: string;
            };
            const names: string[] = [];
            stack.addEventListener('notify::visible-child-name', (e) =>
                names.push((e as CustomEvent).detail['visible-child-name']),
            );
            document.body.append(stack);
            try {
                stack.addTitled(document.createElement('div'), 'a', 'A');
                stack.addTitled(document.createElement('div'), 'b', 'B');
                stack.visibleChildName = 'b';
                expect(names.join()).toBe('a,b');
            } finally {
                stack.remove();
            }
        });
        await it('declares the notify each of DropDown, Stack and Switch dispatches', () => {
            const declared = (tag: string) =>
                (customElements.get(tag) as unknown as { signals: Record<string, string> }).signals;
            expect(declared('gtk-drop-down')['notify::selected']).toBe('notify::selected');
            expect(declared('gtk-stack')['notify::visible-child-name']).toBe('notify::visible-child-name');
            expect(declared('gtk-switch')['notify::active']).toBe('notify::active');
        });
        await it('refuses a bind to an id nothing has, to a source that dispatches no notify, and the flags', () => {
            const bound = (binding: NonNullable<SharedTreeNode['bindings']>[string], sourceTag = 'GtkToggleButton') =>
                ({
                    tag: 'GtkBox',
                    children: [
                        { tag: sourceTag, id: 'source' },
                        { tag: 'GtkToggleButton', bindings: { active: binding } },
                    ],
                }) as SharedTreeNode;
            expect(() => mountSharedTree(bound({ source: 'nobody', property: 'active' }))).toThrow("id 'nobody'");
            expect(() => mountSharedTree(bound({ source: 'template', property: 'active' }))).toThrow("id 'template'");
            expect(() => mountSharedTree(bound({ source: 'source', property: 'active' }, 'GtkLabel'))).toThrow(
                "dispatches no 'notify::active'",
            );
            expect(() => mountSharedTree(bound({ source: 'source', property: 'active', flags: ['inverted'] }))).toThrow(
                'plain form only',
            );
        });
        await it('refuses a breakpoint setter that names no object, and a condition nobody can read', () => {
            const withBreakpoint = (object: string, condition = 'max-width: 400px') =>
                ({
                    tag: 'GtkBox',
                    children: [{ tag: 'GtkLabel', id: 'caption' }],
                    breakpoints: [{ condition, setters: [{ object, property: 'label', value: 'x' }] }],
                }) as SharedTreeNode;
            expect(() => mountSharedTree(withBreakpoint('nobody'))).toThrow("id 'nobody'");
            expect(() => mountSharedTree(withBreakpoint('template'))).toThrow("id 'template'");
            expect(() => mountSharedTree(withBreakpoint('caption', 'wide please'))).toThrow('breakpoint condition');
        });
        await it('does not read a registered name for a node that is not extern', () => {
            const el = buildSharedTree({ tag: 'GtkBox', children: [{ tag: 'GtkLabel' }] });
            expect(el.children[0]!.localName).toBe('gtk-label');
        });
    });
};

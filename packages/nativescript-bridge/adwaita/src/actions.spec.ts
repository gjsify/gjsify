// The `GAction` registry a Blueprint button's `action-name` resolves through — NS-core-free,
// so the chain walk is driven by plain objects standing in for views.

import { describe, expect, it } from '@gjsify/unit';

import {
    SimpleAction,
    SimpleActionGroup,
    activateWidgetAction,
    findActionGroup,
    insertActionGroup,
    type ActionHost,
} from './widgets/actions.js';

const host = (parent: ActionHost | null = null): ActionHost => ({ parent });

export default async () => {
    await describe('SimpleAction / SimpleActionGroup', async () => {
        await it('runs every activate handler with the parameter, until disconnected', () => {
            const action = new SimpleAction({ name: 'copy' });
            const seen: unknown[] = [];
            const id = action.connect('activate', (_a, p) => seen.push(p));
            action.activate('x');
            action.disconnect(id);
            action.activate('y');
            expect(seen).toStrictEqual(['x']);
        });

        await it('a disabled action swallows activation', () => {
            const action = new SimpleAction({ name: 'copy', enabled: false });
            let ran = 0;
            action.connect('activate', () => ran++);
            action.activate();
            expect(ran).toBe(0);
        });

        await it('refuses a name with a dot and a signal other than activate', () => {
            expect(() => new SimpleAction({ name: 'a.b' })).toThrow();
            expect(() => new SimpleAction({ name: '' })).toThrow();
            expect(() => new SimpleAction({ name: 'a' }).connect('changed' as never, () => {})).toThrow();
        });

        await it('the group adds, looks up, lists, activates and removes', () => {
            const group = new SimpleActionGroup();
            const action = new SimpleAction({ name: 'copy' });
            let ran = 0;
            action.connect('activate', () => ran++);
            group.add_action(action);
            expect(group.has_action('copy')).toBe(true);
            expect(group.lookup_action('copy') === action).toBe(true);
            expect(group.list_actions()).toStrictEqual(['copy']);
            expect(group.activate_action('copy')).toBe(true);
            expect(ran).toBe(1);
            group.remove_action('copy');
            expect(group.activate_action('copy')).toBe(false);
            expect(group.lookup_action('copy')).toBe(null);
        });
    });

    await describe('insertActionGroup / activateWidgetAction', async () => {
        await it('resolves `prefix.name` on the widget itself and on every descendant', () => {
            const root = host();
            const mid = host(root);
            const leaf = host(mid);
            const group = new SimpleActionGroup();
            let ran = 0;
            const action = new SimpleAction({ name: 'copy' });
            action.connect('activate', () => ran++);
            group.add_action(action);
            insertActionGroup(root, 'source-view', group);
            expect(activateWidgetAction(leaf, 'source-view.copy')).toBe(true);
            expect(activateWidgetAction(root, 'source-view.copy')).toBe(true);
            expect(ran).toBe(2);
        });

        await it('the nearest ancestor wins, and removal exposes the outer group again', () => {
            const outer = host();
            const inner = host(outer);
            const hits: string[] = [];
            const make = (tag: string) => {
                const group = new SimpleActionGroup();
                const action = new SimpleAction({ name: 'go' });
                action.connect('activate', () => hits.push(tag));
                group.add_action(action);
                return group;
            };
            insertActionGroup(outer, 'win', make('outer'));
            insertActionGroup(inner, 'win', make('inner'));
            activateWidgetAction(inner, 'win.go');
            insertActionGroup(inner, 'win', null);
            activateWidgetAction(inner, 'win.go');
            expect(hits).toStrictEqual(['inner', 'outer']);
        });

        await it('is false for a dangling name, an unprefixed name and a disabled action', () => {
            const root = host();
            const group = new SimpleActionGroup();
            const off = new SimpleAction({ name: 'off', enabled: false });
            group.add_action(off);
            insertActionGroup(root, 'win', group);
            expect(activateWidgetAction(root, 'win.missing')).toBe(false);
            expect(activateWidgetAction(root, 'other.off')).toBe(false);
            expect(activateWidgetAction(root, 'noprefix')).toBe(false);
            expect(activateWidgetAction(root, 'win.off')).toBe(false);
            expect(findActionGroup(root, 'win') === group).toBe(true);
            expect(findActionGroup(root, 'other')).toBe(null);
        });
    });
};

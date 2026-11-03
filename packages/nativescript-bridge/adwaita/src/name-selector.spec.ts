import { describe, expect, it } from '@gjsify/unit';

import { CSSHelper } from '@nativescript/core';

import * as Gtk from './namespace/gtk.js';
import { installNameSelector, type IdSelectorClass } from './name-selector.js';

// NativeScript's IdSelector as it ships: the id and nothing else, filed under the id index.
function stockIdSelector() {
    const filed: string[] = [];
    class IdSelector {
        constructor(public id: string) {}
        match(node: { id?: string; name?: unknown }) {
            return node.id === this.id;
        }
        lookupSort(
            sorter: { sortById?(id: string, sel: unknown): void; sortAsUniversal(sel: unknown): void },
            base?: unknown,
        ) {
            filed.push('id');
            sorter.sortById?.(this.id, base ?? this);
        }
    }
    return {
        IdSelector: IdSelector as unknown as IdSelectorClass & (new (id: string) => InstanceType<typeof IdSelector>),
        filed,
    };
}

export default async () => {
    await describe('#name matches a widget by its GTK name', async () => {
        await it('matches the id as before and the name besides', () => {
            const { IdSelector } = stockIdSelector();
            installNameSelector(IdSelector);
            const selector = new IdSelector('main-button');
            expect(selector.match({ id: 'main-button' })).toBe(true);
            expect(selector.match({ id: 'mainButton', name: 'main-button' })).toBe(true);
            expect(selector.match({ id: 'mainButton', name: 'other' })).toBe(false);
            expect(selector.match({ id: 'mainButton' })).toBe(false);
            expect(selector.match({ id: 'mainButton', name: 3 })).toBe(false);
        });
        await it('files the rule with the universal ones, because the id index cannot see a name', () => {
            const { IdSelector } = stockIdSelector();
            installNameSelector(IdSelector);
            const calls: string[] = [];
            new IdSelector('a').lookupSort({
                sortAsUniversal: () => calls.push('universal'),
                sortById: () => calls.push('id'),
            });
            expect(calls.join()).toBe('universal');
        });
        await it('installs once', () => {
            const { IdSelector } = stockIdSelector();
            expect(installNameSelector(IdSelector)).toBe(true);
            expect(installNameSelector(IdSelector)).toBe(false);
        });
        await it('is installed by the first widget that is given a name', () => {
            const button = new Gtk.Button();
            (button as unknown as { name: string }).name = 'main-button';
            const selector = CSSHelper.createSelector('#main-button') as { match(node: object): boolean };
            expect(selector.match({ id: 'mainButton', name: 'main-button' })).toBe(true);
        });
    });
};

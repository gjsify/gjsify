import { describe, expect, it } from '@gjsify/unit';
import { goaAccountId, type GoaSourceLike } from './eds/goa.js';

const GOA = 'GNOME Online Accounts';

function source(parent: string | null, accountId?: string): GoaSourceLike {
    return {
        has_extension: (name) => name === GOA && accountId !== undefined,
        get_extension: () => ({ get_account_id: () => accountId ?? null }),
        get_parent: () => parent,
    };
}

export default async () => {
    await describe('goaAccountId', async () => {
        await it('finds the account on the collection above the calendar', async () => {
            const reg: Record<string, GoaSourceLike> = { collection: source(null, 'account_1') };
            expect(goaAccountId(source('collection'), (uid) => reg[uid] ?? null, GOA)).toBe('account_1');
        });

        await it('answers null for a local calendar', async () => {
            expect(goaAccountId(source(null), () => null, GOA)).toBeNull();
            expect(goaAccountId(source('gone'), () => null, GOA)).toBeNull();
        });

        await it('stops on a parent cycle', async () => {
            const reg: Record<string, GoaSourceLike> = { a: source('b'), b: source('a') };
            expect(goaAccountId(source('a'), (uid) => reg[uid] ?? null, GOA)).toBeNull();
        });
    });
};

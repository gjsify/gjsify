import * as Comlink from 'comlink';

const api = {
    answer: 42,
    add: (a, b) => a + b,
    slowAdd: async (a, b) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return a + b;
    },
    throws: () => {
        throw new TypeError('from-the-worker');
    },
    withCallback: async (callback) => `callback returned ${await callback(7)}`,
    structured: () => ({
        when: new Date(0),
        set: new Set([1, 2]),
        map: new Map([['k', 1]]),
        big: 1n,
        bytes: new Uint8Array([1, 2, 3]),
    }),
    rows: (n) =>
        Array.from({ length: n }, (_, i) => ({
            id: i,
            name: `item-${i}`,
            qty: i % 97,
            price: (i % 1000) / 100,
            active: i % 3 === 0,
            note: 'lorem ipsum dolor sit amet consectetur',
        })),
};

Comlink.expose(api, self);

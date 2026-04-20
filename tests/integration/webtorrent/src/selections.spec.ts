// SPDX-License-Identifier: MIT
// Ported from refs/webtorrent/test/selections.js
// Original: Copyright (c) WebTorrent, LLC and WebTorrent contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import {
  Selections,
  isCoveringExisting,
  isInsideExisting,
  isLowerIntersecting,
  isUpperIntersecting,
} from 'webtorrent/lib/selections.js';

interface Range {
  from: number;
  to: number;
}
interface Case {
  newItem: Range;
  existing: Range;
  expectedRemoveResult: Range[];
}
type CaseFn = (newItem: Range, existing: Range) => boolean;

const testCases: Record<string, { fn: CaseFn; cases: Case[] }> = {
  isLowerIntersecting: {
    fn: isLowerIntersecting as CaseFn,
    cases: [
      { newItem: { from: 8, to: 12 }, existing: { from: 1, to: 10 }, expectedRemoveResult: [{ from: 1, to: 7 }] },
      { newItem: { from: 10, to: 15 }, existing: { from: 1, to: 10 }, expectedRemoveResult: [{ from: 1, to: 9 }] },
    ],
  },
  isUpperIntersecting: {
    fn: isUpperIntersecting as CaseFn,
    cases: [
      { newItem: { from: 15, to: 22 }, existing: { from: 20, to: 25 }, expectedRemoveResult: [{ from: 23, to: 25 }] },
      { newItem: { from: 15, to: 20 }, existing: { from: 20, to: 25 }, expectedRemoveResult: [{ from: 21, to: 25 }] },
    ],
  },
  isInsideExisting: {
    fn: isInsideExisting as CaseFn,
    cases: [
      { newItem: { from: 12, to: 15 }, existing: { from: 10, to: 20 }, expectedRemoveResult: [{ from: 10, to: 11 }, { from: 16, to: 20 }] },
      { newItem: { from: 20, to: 20 }, existing: { from: 10, to: 20 }, expectedRemoveResult: [{ from: 10, to: 19 }] },
      { newItem: { from: 15, to: 20 }, existing: { from: 10, to: 20 }, expectedRemoveResult: [{ from: 10, to: 14 }] },
    ],
  },
  isCoveringExisting: {
    fn: isCoveringExisting as CaseFn,
    cases: [
      { newItem: { from: 10, to: 21 }, existing: { from: 10, to: 20 }, expectedRemoveResult: [] },
      { newItem: { from: 9, to: 20 }, existing: { from: 10, to: 20 }, expectedRemoveResult: [] },
      { newItem: { from: 10, to: 20 }, existing: { from: 10, to: 20 }, expectedRemoveResult: [] },
      { newItem: { from: 0, to: 986 }, existing: { from: 15, to: 986 }, expectedRemoveResult: [] },
    ],
  },
};

function toString(param: Range | Range[]): string {
  if (!Array.isArray(param)) {
    const { from, to } = param;
    return `[${from}-${to}]`;
  }
  return `[${param.map(toString).join(', ')}]`;
}

function assertArrayContentsEqual(actual: Range[], expected: Range[]) {
  expect(actual.length).toBe(expected.length);
  for (const item of actual) {
    expect(expected.some((e) => e.from === item.from && e.to === item.to)).toBeTruthy();
  }
}

export default async () => {
  await describe('webtorrent/selections: predicate truthiness', async () => {
    for (const [functionName, { fn, cases }] of Object.entries(testCases)) {
      for (const { newItem, existing } of cases) {
        await it(`${functionName} for newItem: ${toString(newItem)} and existing: ${toString(existing)}`, () => {
          expect(fn(newItem, existing)).toBe(true);
          for (const otherFn of Object.keys(testCases)) {
            if (otherFn !== functionName) {
              expect(testCases[otherFn].fn(newItem, existing)).toBe(false);
            }
          }
        });
      }
    }
  });

  await describe('webtorrent/selections: remove', async () => {
    for (const [functionName, { cases }] of Object.entries(testCases)) {
      for (const { newItem, existing, expectedRemoveResult } of cases) {
        await it(`remove ${toString(newItem)} from ${toString(existing)} leaves ${toString(expectedRemoveResult)} (${functionName})`, () => {
          const selection = new Selections();
          selection.insert(existing);
          selection.remove(newItem);
          assertArrayContentsEqual(selection._items, expectedRemoveResult);
        });
      }
    }
  });

  await describe('webtorrent/selections: insert truncates overlaps', async () => {
    for (const [functionName, { cases }] of Object.entries(testCases)) {
      for (const { newItem, existing, expectedRemoveResult } of cases) {
        await it(`insert ${toString(newItem)} over ${toString(existing)} (${functionName})`, () => {
          const selection = new Selections();
          selection.insert(existing);
          selection.insert(newItem);
          const expected: Range = { from: Infinity, to: 0 };
          for (const item of [...expectedRemoveResult, newItem]) {
            expected.from = Math.min(expected.from, item.from);
            expected.to = Math.max(expected.to, item.to);
          }
          assertArrayContentsEqual(selection._items, [expected]);
        });
      }
    }
  });

  await describe('webtorrent/selections: large insert truncates / deletes existing', async () => {
    await it('inserts {from:9, to:25} over three existing selections', () => {
      const selection = new Selections();
      selection.insert({ from: 5, to: 10 });
      selection.insert({ from: 11, to: 19 });
      selection.insert({ from: 20, to: 40 });

      selection.insert({ from: 9, to: 25 });

      assertArrayContentsEqual(selection._items, [{ from: 5, to: 40 }]);
    });
  });
};

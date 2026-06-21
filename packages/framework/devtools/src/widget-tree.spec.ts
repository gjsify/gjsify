// @gjsify/devtools — widget-path parse/build tests (pure logic).

import { describe, expect, it } from '@gjsify/unit';
import { buildWidgetPath, parseWidgetPath } from './widget-tree.js';

export default async () => {
    await describe('parseWidgetPath', async () => {
        await it('parses a toplevel-only path', async () => {
            expect(parseWidgetPath('toplevel:0')).toStrictEqual({ toplevel: 0, children: [] });
        });

        await it('parses a nested path', async () => {
            expect(parseWidgetPath('toplevel:2/child:0/child:3')).toStrictEqual({ toplevel: 2, children: [0, 3] });
        });

        await it('rejects malformed paths', async () => {
            expect(parseWidgetPath('')).toBeNull();
            expect(parseWidgetPath('child:0')).toBeNull();
            expect(parseWidgetPath('toplevel:x')).toBeNull();
            expect(parseWidgetPath('toplevel:0/nope:1')).toBeNull();
        });
    });

    await describe('buildWidgetPath', async () => {
        await it('round-trips with parseWidgetPath', async () => {
            const path = buildWidgetPath(2, [0, 3]);
            expect(path).toBe('toplevel:2/child:0/child:3');
            expect(parseWidgetPath(path)).toStrictEqual({ toplevel: 2, children: [0, 3] });
        });

        await it('builds a toplevel-only path', async () => {
            expect(buildWidgetPath(0, [])).toBe('toplevel:0');
        });
    });
};

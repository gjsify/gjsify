// `util.inspect` + its `.custom` / `.defaultOptions` / `.colors` / `.styles`
// surface.
//
// Reference: Node.js lib/util.js (the legacy `inspect` path; the new
//   pretty-print pipeline is intentionally not modelled — too tightly
//   coupled to V8 internals).
// Original: see index.ts pre-split.

import type { InspectOptions } from 'node:util';

export const kCustomInspect = Symbol.for('nodejs.util.inspect.custom');

function inspectValue(value: unknown, opts: InspectOptions, depth: number): string {
    if (value === null) return opts.colors ? '\x1b[1mnull\x1b[22m' : 'null';
    if (value === undefined) return opts.colors ? '\x1b[90mundefined\x1b[39m' : 'undefined';

    const maxDepth = opts.depth ?? 2;

    if (typeof value === 'string') {
        const escaped = value.replace(/\\/g, '\\\\');
        // Smart quoting: use double quotes if string contains single quote but no double quote
        if (value.includes("'") && !value.includes('"')) {
            const dq = escaped.replace(/"/g, '\\"');
            return opts.colors ? `\x1b[32m"${dq}"\x1b[39m` : `"${dq}"`;
        }
        const sq = escaped.replace(/'/g, "\\'");
        return opts.colors ? `\x1b[32m'${sq}'\x1b[39m` : `'${sq}'`;
    }
    if (typeof value === 'number') {
        return opts.colors ? `\x1b[33m${value}\x1b[39m` : String(value);
    }
    if (typeof value === 'bigint') {
        return opts.colors ? `\x1b[33m${value}n\x1b[39m` : `${value}n`;
    }
    if (typeof value === 'boolean') {
        return opts.colors ? `\x1b[33m${value}\x1b[39m` : String(value);
    }
    if (typeof value === 'symbol') {
        return opts.colors ? `\x1b[32m${value.toString()}\x1b[39m` : value.toString();
    }
    if (typeof value === 'function') {
        const name = value.name ? `: ${value.name}` : '';
        return opts.colors ? `\x1b[36m[Function${name}]\x1b[39m` : `[Function${name}]`;
    }

    // Custom inspect
    if (value !== null && typeof value === 'object' && kCustomInspect in (value as Record<symbol, unknown>)) {
        const custom = (value as Record<symbol, unknown>)[kCustomInspect];
        if (typeof custom === 'function') {
            const result = custom.call(value, depth, opts);
            if (typeof result === 'string') return result;
            return inspectValue(result, opts, depth);
        }
    }

    if (value instanceof Date) {
        return value.toISOString();
    }
    if (value instanceof RegExp) {
        return opts.colors ? `\x1b[31m${value.toString()}\x1b[39m` : value.toString();
    }
    if (value instanceof Error) {
        return value.stack || value.toString();
    }

    if (depth > maxDepth) {
        return Array.isArray(value) ? '[Array]' : '[Object]';
    }

    if (Array.isArray(value)) {
        return inspectArray(value, opts, depth);
    }

    if (value instanceof Map) {
        const entries = [...value.entries()].map(
            ([k, v]) => `${inspectValue(k, opts, depth + 1)} => ${inspectValue(v, opts, depth + 1)}`,
        );
        return `Map(${value.size}) { ${entries.join(', ')} }`;
    }

    if (value instanceof Set) {
        const entries = [...value].map((v) => inspectValue(v, opts, depth + 1));
        return `Set(${value.size}) { ${entries.join(', ')} }`;
    }

    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
        const name = value.constructor?.name || 'TypedArray';
        const arr = Array.from(value as Uint8Array);
        return `${name}(${arr.length}) [ ${arr.join(', ')} ]`;
    }

    return inspectObject(value as Record<string, unknown>, opts, depth);
}

function inspectArray(arr: unknown[], opts: InspectOptions, depth: number): string {
    const maxLen = opts.maxArrayLength ?? 100;
    const len = Math.min(arr.length, maxLen);
    const items: string[] = [];
    for (let i = 0; i < len; i++) {
        items.push(inspectValue(arr[i], opts, depth + 1));
    }
    if (arr.length > maxLen) {
        items.push(`... ${arr.length - maxLen} more items`);
    }

    // Show hidden properties like [length] when showHidden is true
    if (opts.showHidden) {
        items.push(`[length]: ${arr.length}`);
    }

    const breakLength = opts.breakLength ?? 72;
    const compact = opts.compact ?? 3;

    // Compact grouping: when array has more elements than compact threshold,
    // use grouped multiline format (multiple items per line)
    if (typeof compact === 'number' && compact > 0 && arr.length > compact) {
        const indent = '  ';
        const indentLen = indent.length;
        // Calculate max item length (strip ANSI for measurement)
        // oxlint-disable-next-line no-control-regex -- ESC (\x1b) is the ANSI SGR introducer we intentionally strip
        const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
        const maxItemLen = Math.max(...items.map((item) => stripAnsi(item).length));
        const biasedMax = Math.max(maxItemLen - 2, 1);
        const numItems = items.length;
        const approxCharHeights = 2.5;
        const columns = Math.min(
            Math.round(Math.sqrt(approxCharHeights * biasedMax * numItems) / biasedMax),
            Math.floor((breakLength - indentLen) / biasedMax),
            Math.floor((2.5 + numItems - 1) / 2),
            15,
        );
        if (columns > 1) {
            const rows: string[] = [];
            for (let i = 0; i < numItems; i += columns) {
                rows.push(indent + items.slice(i, Math.min(i + columns, numItems)).join(', '));
            }
            return `[\n${rows.join(',\n')}\n]`;
        }
    }

    const singleLine = `[ ${items.join(', ')} ]`;
    if (singleLine.length <= breakLength) return singleLine;

    return `[\n${items.map((i) => '  ' + i).join(',\n')}\n]`;
}

function inspectObject(obj: Record<string, unknown>, opts: InspectOptions, depth: number): string {
    const keys = opts.showHidden ? Object.getOwnPropertyNames(obj) : Object.keys(obj);

    if (opts.sorted) keys.sort();

    if (keys.length === 0) {
        const tag = Object.prototype.toString.call(obj);
        if (tag !== '[object Object]') return tag;
        return '{}';
    }

    const items = keys.map((key) => {
        const val = inspectValue(obj[key], opts, depth + 1);
        return `${key}: ${val}`;
    });

    const breakLength = opts.breakLength ?? 72;
    const singleLine = `{ ${items.join(', ')} }`;
    if (singleLine.length <= breakLength) return singleLine;

    return `{\n${items.map((i) => '  ' + i).join(',\n')}\n}`;
}

export function inspect(value: unknown, opts?: boolean | InspectOptions): string {
    const options: InspectOptions = typeof opts === 'boolean' ? { showHidden: opts } : { ...opts };

    if (options.colors === undefined) options.colors = false;
    return inspectValue(value, options, 0);
}

inspect.custom = kCustomInspect;
inspect.defaultOptions = {
    showHidden: false,
    depth: 2,
    colors: false,
    maxArrayLength: 100,
    maxStringLength: 10000,
    breakLength: 72,
    compact: 3,
    sorted: false,
};

/** ANSI color code pairs [open, close] for terminal coloring. */
inspect.colors = {
    reset: [0, 0],
    bold: [1, 22],
    dim: [2, 22],
    italic: [3, 23],
    underline: [4, 24],
    blink: [5, 25],
    inverse: [7, 27],
    hidden: [8, 28],
    strikethrough: [9, 29],
    doubleunderline: [21, 24],
    black: [30, 39],
    red: [31, 39],
    green: [32, 39],
    yellow: [33, 39],
    blue: [34, 39],
    magenta: [35, 39],
    cyan: [36, 39],
    white: [37, 39],
    bgBlack: [40, 49],
    bgRed: [41, 49],
    bgGreen: [42, 49],
    bgYellow: [43, 49],
    bgBlue: [44, 49],
    bgMagenta: [45, 49],
    bgCyan: [46, 49],
    bgWhite: [47, 49],
    framed: [51, 54],
    overlined: [53, 55],
    gray: [90, 39],
    grey: [90, 39],
    redBright: [91, 39],
    greenBright: [92, 39],
    yellowBright: [93, 39],
    blueBright: [94, 39],
    magentaBright: [95, 39],
    cyanBright: [96, 39],
    whiteBright: [97, 39],
    bgBlackBright: [100, 49],
    bgRedBright: [101, 49],
    bgGreenBright: [102, 49],
    bgYellowBright: [103, 49],
    bgBlueBright: [104, 49],
    bgMagentaBright: [105, 49],
    bgCyanBright: [106, 49],
    bgWhiteBright: [107, 49],
} as Record<string, [number, number]>;

/** Maps type names to color names for util.inspect output styling. */
inspect.styles = {
    special: 'cyan',
    number: 'yellow',
    bigint: 'yellow',
    boolean: 'yellow',
    undefined: 'grey',
    null: 'bold',
    string: 'green',
    symbol: 'green',
    date: 'magenta',
    regexp: 'red',
    module: 'underline',
} as Record<string, string>;

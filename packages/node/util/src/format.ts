// `util.format` + `util.formatWithOptions` + `util.styleText` +
// `util.stripVTControlCharacters`.
//
// Reference: Node.js lib/util.js. ANSI regex copied from chalk/ansi-regex
//   (Sindre Sorhus, MIT) — same source Node uses upstream.
// Original: see index.ts pre-split.

import type { InspectOptions } from 'node:util';
import { inspect } from './inspect.js';

export function format(fmt: string, ...args: unknown[]): string {
    // format() with no args returns ''
    if (fmt === undefined && args.length === 0) return '';

    if (typeof fmt !== 'string') {
        if (args.length === 0) return inspect(fmt);
        const parts = [inspect(fmt)];
        for (const arg of args) parts.push(inspect(arg));
        return parts.join(' ');
    }

    let i = 0;
    let result = '';
    let lastIdx = 0;

    for (let p = 0; p < fmt.length - 1; p++) {
        if (fmt[p] !== '%') continue;

        if (p > lastIdx) result += fmt.slice(lastIdx, p);

        const next = fmt[p + 1];

        // %% always produces literal % (no arg consumed)
        if (next === '%') {
            result += '%';
            lastIdx = p + 2;
            p++;
            continue;
        }

        if (i >= args.length) {
            result += '%' + next;
            lastIdx = p + 2;
            p++;
            continue;
        }

        const arg = args[i];
        switch (next) {
            case 's': {
                if (typeof arg === 'bigint') {
                    result += `${arg}n`;
                } else if (typeof arg === 'symbol') {
                    result += arg.toString();
                } else if (typeof arg === 'number' && Object.is(arg, -0)) {
                    result += '-0';
                } else if (typeof arg === 'object' && arg !== null) {
                    // Objects with custom toString use it, others get inspect
                    const proto = Object.getPrototypeOf(arg);
                    if (
                        proto === null ||
                        (typeof arg.toString === 'function' &&
                            arg.toString !== Object.prototype.toString &&
                            arg.toString !== Array.prototype.toString)
                    ) {
                        try {
                            const str = arg.toString();
                            if (typeof str === 'string' && str !== '[object Object]') {
                                result += str;
                            } else {
                                result += inspect(arg, { depth: 0 });
                            }
                        } catch {
                            result += inspect(arg, { depth: 0 });
                        }
                    } else {
                        result += inspect(arg, { depth: 0 });
                    }
                } else {
                    result += String(arg);
                }
                i++;
                break;
            }
            case 'd': {
                if (typeof arg === 'bigint') {
                    result += `${arg}n`;
                } else if (typeof arg === 'symbol') {
                    result += 'NaN';
                } else {
                    const n = Number(arg);
                    result += Object.is(n, -0) ? '-0' : String(n);
                }
                i++;
                break;
            }
            case 'i': {
                if (typeof arg === 'bigint') {
                    result += `${arg}n`;
                } else if (typeof arg === 'symbol') {
                    result += 'NaN';
                } else {
                    const n = Number(arg);
                    if (!isFinite(n)) {
                        // Node.js: parseInt('Infinity') → NaN, parseInt('-Infinity') → NaN
                        result += 'NaN';
                    } else {
                        const truncated = Math.trunc(n);
                        result += Object.is(truncated, -0) ? '-0' : String(truncated);
                    }
                }
                i++;
                break;
            }
            case 'f': {
                if (typeof arg === 'bigint') {
                    result += Number(arg).toString();
                } else if (typeof arg === 'symbol') {
                    result += 'NaN';
                } else {
                    const n = parseFloat(String(arg));
                    result += Object.is(n, -0) ? '-0' : String(n);
                }
                i++;
                break;
            }
            case 'j':
                try {
                    result += JSON.stringify(args[i++]);
                } catch {
                    result += '[Circular]';
                }
                break;
            case 'o':
                result += inspect(args[i++], { showHidden: true, depth: 4 });
                break;
            case 'O':
                result += inspect(args[i++], { depth: 4 });
                break;
            default:
                result += '%' + next;
                break;
        }
        lastIdx = p + 2;
        p++;
    }

    if (lastIdx < fmt.length) {
        result += fmt.slice(lastIdx);
    }

    // Append remaining args (strings passed as-is, objects inspected)
    for (; i < args.length; i++) {
        const arg = args[i];
        if (typeof arg === 'string') {
            result += ' ' + arg;
        } else {
            result += ' ' + inspect(arg);
        }
    }

    return result;
}

export function formatWithOptions(inspectOptions: InspectOptions, fmt: string, ...args: unknown[]): string {
    // Apply inspect options to embedded inspect calls — simplified implementation
    void inspectOptions;
    return format(fmt, ...args);
}

// Matches all ANSI escape code sequences. Same regex used by Node — sourced
// from Sindre Sorhus's chalk/ansi-regex (MIT). Kept module-local; the only
// consumer is stripVTControlCharacters and its callers.
const ANSI_REGEX = new RegExp(
    '[\\u001B\\u009B][[\\]()#;?]*' +
        '(?:(?:(?:(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]+)*' +
        '|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]*)*)?' +
        '(?:\\u0007|\\u001B\\u005C|\\u009C))' +
        '|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?' +
        '[\\dA-PR-TZcf-nq-uy=><~]))',
    'g',
);

export function stripVTControlCharacters(str: string): string {
    if (typeof str !== 'string') {
        throw new TypeError('The "str" argument must be of type string. Received ' + typeof str);
    }
    // Short-circuit: ESC (0x1B) or CSI (0x9B) introducer must be present.
    if (str.indexOf('\x1b') === -1 && str.indexOf('\x9b') === -1) return str;
    return str.replace(ANSI_REGEX, '');
}

interface StyleTextOptions {
    validateStream?: boolean;
    stream?: { isTTY?: boolean };
}

/**
 * Apply ANSI styling to text, using the format names from `inspect.colors`.
 * Per Node's spec, when `validateStream` is true (default) and the target
 * stream is not a TTY, return the unstyled text. We use `process.stdout` as
 * the default stream — the same as Node.
 */
export function styleText(format: string | string[], text: string, options?: StyleTextOptions): string {
    if (typeof text !== 'string') {
        throw new TypeError('The "text" argument must be of type string. Received ' + typeof text);
    }
    const validateStream = options?.validateStream ?? true;
    if (validateStream) {
        const stream =
            options?.stream ?? (globalThis as { process?: { stdout?: { isTTY?: boolean } } }).process?.stdout;
        if (!stream?.isTTY) return text;
    }

    const formats = Array.isArray(format) ? format : [format];
    let openCodes = '';
    let closeCodes = '';
    for (const key of formats) {
        if (key === 'none') continue;
        const style = inspect.colors[key];
        if (style === undefined) {
            throw new TypeError(
                `The "format" argument must be one of: ${Object.keys(inspect.colors).join(', ')}. Received '${key}'`,
            );
        }
        openCodes += `\x1b[${style[0]}m`;
        closeCodes = `\x1b[${style[1]}m` + closeCodes;
    }
    return `${openCodes}${text}${closeCodes}`;
}

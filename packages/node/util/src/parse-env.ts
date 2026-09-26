// `util.parseEnv(content)` — parse `.env` text the way Node does.
// Ported from refs/node/src/node_dotenv.cc (`Dotenv::ParseContent`, `trim_spaces`).
// Copyright Node.js contributors. MIT license.
//
// Node implements this in C++ and exposes it through a binding, so there is no JS to
// reuse; the port keeps the C++ control flow line for line, because the edge cases ARE
// the contract (an unclosed quote takes the rest of its line, only a double-quoted
// value expands `\n`, a later duplicate key wins).

interface ErrnoBrand {
    code?: string;
}

/** Trim ` `, `\t` and `\n` from both ends — not `\r`, which is removed up front. */
function trimSpaces(input: string): string {
    let start = 0;
    let end = input.length;
    while (start < end && ' \t\n'.includes(input[start]!)) start++;
    while (end > start && ' \t\n'.includes(input[end - 1]!)) end--;
    return input.slice(start, end);
}

export function parseEnv(content: string): Record<string, string> {
    if (typeof content !== 'string') {
        const err = new TypeError(
            `The "content" argument must be of type string. Received ${content === null ? 'null' : typeof content}`,
        );
        (err as TypeError & ErrnoBrand).code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    const store: Record<string, string> = Object.create(null);
    let rest = trimSpaces(content.replace(/\r/g, ''));

    while (rest.length > 0) {
        if (rest[0] === '\n' || rest[0] === '#') {
            const newline = rest.indexOf('\n');
            rest = newline === -1 ? '' : rest.slice(newline + 1);
            continue;
        }

        const equalOrNewline = rest.search(/[=\n]/);
        if (equalOrNewline === -1) break;
        if (rest[equalOrNewline] === '\n') {
            rest = trimSpaces(rest.slice(equalOrNewline + 1));
            continue;
        }

        let key = trimSpaces(rest.slice(0, equalOrNewline));
        rest = rest.slice(equalOrNewline + 1);

        if (rest.length === 0 || rest[0] === '\n') {
            store[key] = '';
            continue;
        }

        rest = trimSpaces(rest);
        if (key.length === 0) continue;
        if (key.startsWith('export ')) key = trimSpaces(key.slice(7));

        if (rest.length === 0) {
            store[key] = '';
            break;
        }

        if (rest[0] === '"') {
            const closing = rest.indexOf('"', 1);
            if (closing !== -1) {
                store[key] = rest.slice(1, closing).replace(/\\n/g, '\n');
                const newline = rest.indexOf('\n', closing + 1);
                rest = newline === -1 ? '' : rest.slice(newline + 1);
                continue;
            }
        }

        if (rest[0] === "'" || rest[0] === '"' || rest[0] === '`') {
            const closing = rest.indexOf(rest[0], 1);
            if (closing === -1) {
                const newline = rest.indexOf('\n');
                if (newline === -1) {
                    store[key] = rest;
                    break;
                }
                store[key] = rest.slice(0, newline);
                rest = rest.slice(newline + 1);
            } else {
                store[key] = rest.slice(1, closing);
                const newline = rest.indexOf('\n', closing + 1);
                rest = newline === -1 ? '' : rest.slice(newline + 1);
                continue;
            }
        } else {
            const newline = rest.indexOf('\n');
            let value = newline === -1 ? rest : rest.slice(0, newline);
            const hash = value.indexOf('#');
            if (hash !== -1) value = value.slice(0, hash);
            store[key] = trimSpaces(value);
            rest = newline === -1 ? '' : rest.slice(newline + 1);
        }

        rest = trimSpaces(rest);
    }
    // Node 24 hands back an ordinary object (Node 27 switched to a null prototype).
    // Defined, not assigned, so a `__proto__=…` line stays a key and cannot swap the
    // prototype.
    const result: Record<string, string> = {};
    for (const key of Object.keys(store)) {
        Object.defineProperty(result, key, { value: store[key], enumerable: true, writable: true, configurable: true });
    }
    return result;
}

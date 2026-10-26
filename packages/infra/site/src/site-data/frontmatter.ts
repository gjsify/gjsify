export type FrontmatterValue = string | boolean | string[];
export interface Frontmatter {
    data: Record<string, FrontmatterValue>;
    body: string;
}

function stripBom(text: string): string {
    if (text.charCodeAt(0) === 0xfeff) {
        return text.slice(1);
    }
    return text;
}

function unescapeDoubleQuoted(value: string): string {
    let result = '';
    for (let i = 0; i < value.length; i++) {
        const ch = value[i]!;
        if (ch === '\\' && i + 1 < value.length) {
            const next = value[i + 1]!;
            if (next === '"') {
                result += '"';
                i++;
                continue;
            }
            if (next === '\\') {
                result += '\\';
                i++;
                continue;
            }
            if (next === 'n') {
                result += '\n';
                i++;
                continue;
            }
            // For other escapes, keep as-is per common YAML subset behavior? Spec says double supports \" \\ \n escapes
            result += '\\' + next;
            i++;
            continue;
        }
        result += ch;
    }
    return result;
}

function parseScalar(value: string, file: string, lineNumber: number): FrontmatterValue {
    const trimmed = value.trim();
    if (trimmed === '') {
        // Will be handled by caller for dash lists
        return trimmed;
    }
    if (trimmed === 'true') {
        return true;
    }
    if (trimmed === 'false') {
        return false;
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const inner = trimmed.slice(1, -1).trim();
        if (inner === '') {
            return [];
        }
        const result: string[] = [];
        // Simple parser for inline lists
        let current = '';
        let inSingle = false;
        let inDouble = false;
        for (let i = 0; i < inner.length; i++) {
            const ch = inner[i]!;
            if (inDouble) {
                if (ch === '\\' && i + 1 < inner.length) {
                    current += ch + inner[i + 1]!;
                    i++;
                    continue;
                }
                if (ch === '"') {
                    inDouble = false;
                    current += ch;
                    continue;
                }
                current += ch;
                continue;
            }
            if (inSingle) {
                if (ch === "'" && i + 1 < inner.length && inner[i + 1] === "'") {
                    current += "''";
                    i++;
                    continue;
                }
                if (ch === "'") {
                    inSingle = false;
                    current += ch;
                    continue;
                }
                current += ch;
                continue;
            }
            if (ch === '"') {
                inDouble = true;
                current += ch;
                continue;
            }
            if (ch === "'") {
                inSingle = true;
                current += ch;
                continue;
            }
            if (ch === ',') {
                result.push(parseScalar(current, file, lineNumber) as string);
                current = '';
                continue;
            }
            current += ch;
        }
        if (current.trim() !== '') {
            result.push(parseScalar(current, file, lineNumber) as string);
        }
        // Ensure all are strings
        return result.map((r) => String(r));
    }
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        if (trimmed.length < 2) {
            throw new Error(`${file}:${lineNumber}: unclosed quotes`);
        }
        // Check for unclosed
        // Simple check - count unescaped quotes
        const inner = trimmed.slice(1, -1);
        // Validate escapes roughly
        return unescapeDoubleQuoted(inner);
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        if (trimmed.length < 2) {
            throw new Error(`${file}:${lineNumber}: unclosed quotes`);
        }
        const inner = trimmed.slice(1, -1);
        // single supports ''
        return inner.replace(/''/g, "'");
    }
    // Plain scalar
    return trimmed;
}

/** `file` is only used in error messages. Text without a leading `---` line has empty data and the whole text as body. */
export function parseFrontmatter(text: string, file: string): Frontmatter {
    let normalized = stripBom(text).replace(/\r\n/g, '\n');
    if (!normalized.startsWith('---')) {
        return { data: {}, body: text.replace(/\r\n/g, '\n') };
    }
    // Find closing ---
    const lines = normalized.split('\n');
    if (lines[0]?.trim() !== '---') {
        return { data: {}, body: text.replace(/\r\n/g, '\n') };
    }
    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i]?.trim() === '---') {
            endIndex = i;
            break;
        }
    }
    if (endIndex === -1) {
        throw new Error(`${file}: missing closing ---`);
    }
    const data: Record<string, FrontmatterValue> = {};
    const seenKeys = new Set<string>();
    for (let i = 1; i < endIndex; i++) {
        const line = lines[i]!;
        const lineNumber = i + 1; // 1-based relative to start of file for error messages
        // Skip blank lines and comments
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#')) {
            continue;
        }
        // Check for dash list item
        if (line.match(/^\s*-\s+/)) {
            // This would mean we're in a list - but we need to track context
            // For our subset, dash list comes after empty value
            continue;
        }
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) {
            throw new Error(`${file}:${lineNumber}: invalid line`);
        }
        const key = line.slice(0, colonIndex).trim();
        if (key === '') {
            throw new Error(`${file}:${lineNumber}: invalid key`);
        }
        if (seenKeys.has(key)) {
            throw new Error(`${file}:${lineNumber}: duplicate key ${key}`);
        }
        const valuePart = line.slice(colonIndex + 1);
        // Check if empty value followed by dash list
        if (valuePart.trim() === '') {
            // Look ahead for dash list items
            const items: string[] = [];
            let j = i + 1;
            while (j < endIndex) {
                const nextLine = lines[j]!;
                const nextTrimmed = nextLine.trim();
                if (nextTrimmed === '' || nextTrimmed.startsWith('#')) {
                    j++;
                    continue;
                }
                if (nextLine.match(/^\s*-\s+/)) {
                    const itemContent = nextLine.replace(/^\s*-\s+/, '').trim();
                    // Item could be quoted or plain
                    if (itemContent.startsWith('"') && itemContent.endsWith('"')) {
                        items.push(unescapeDoubleQuoted(itemContent.slice(1, -1)));
                    } else if (itemContent.startsWith("'") && itemContent.endsWith("'")) {
                        items.push(itemContent.slice(1, -1).replace(/''/g, "'"));
                    } else {
                        items.push(itemContent);
                    }
                    j++;
                    continue;
                }
                break;
            }
            if (items.length > 0) {
                data[key] = items;
                seenKeys.add(key);
                i = j - 1;
                continue;
            } else {
                // Empty value with nothing after - could be error or just empty? But spec says "empty value followed by dash list lines" gives string[]
                // If no dash list follows, maybe treat as empty string or error? Let us look up - but be conservative
                throw new Error(`${file}:${lineNumber}: invalid value`);
            }
        }
        // Parse scalar value
        // Numbers and dates stay strings: the post decides what they mean.
        data[key] = parseScalar(valuePart, file, lineNumber);
        seenKeys.add(key);
    }
    // Body = everything after the closing delimiter with ONE leading newline removed
    let body = '';
    if (endIndex + 1 < lines.length) {
        const bodyLines = lines.slice(endIndex + 1);
        body = bodyLines.join('\n');
        // Remove ONE leading newline if present
        if (body.startsWith('\n')) {
            body = body.slice(1);
        } else if (body.startsWith('\r\n')) {
            body = body.slice(2);
        }
    }
    return { data, body };
}

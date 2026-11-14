// The autostart file's text, as pure functions: no Gio, so Node can prove them.

/** The key that marks a file as ours. The driver deletes nothing without it. */
export const OWNER_MARKER_KEY = 'X-GJSIFY-Background';

// Desktop Entry spec, "The Exec key": these characters force the argument into double quotes.
const EXEC_RESERVED = /[\s"'\\><~|&;$*?#()`]/;

// A newline or NUL cannot live in a one-line Exec value at all.
const UNREPRESENTABLE = {
    test: (value: string) => value.includes('\0') || value.includes('\n') || value.includes('\r'),
};

/**
 * One argument of an `Exec` line. Three layers apply in this order, each from the spec:
 * `%` is a field-code introducer so a literal one is `%%`; a reserved character puts the
 * argument in double quotes with `"` `` ` `` `$` `\` backslash-escaped; and the file format
 * then reads `\\` as one backslash, so every backslash is doubled once more.
 */
export function quoteExecArg(arg: string): string {
    if (UNREPRESENTABLE.test(arg)) {
        throw new RangeError('an autostart command-line argument cannot contain a newline or NUL');
    }
    let quoted = arg.replaceAll('%', '%%');
    if (arg === '' || EXEC_RESERVED.test(arg)) {
        quoted = `"${quoted.replaceAll(/["`$\\]/g, '\\$&')}"`;
    }
    return quoted.replaceAll('\\', '\\\\');
}

export function execLine(commandline: readonly string[]): string {
    if (commandline.length === 0) throw new RangeError('an autostart command line needs at least the program');
    return commandline.map(quoteExecArg).join(' ');
}

/** The `string` value type of the Desktop Entry spec. */
export function escapeString(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t');
}

export interface AutostartEntry {
    readonly name: string;
    readonly commandline: readonly string[];
}

export function desktopFileText(entry: AutostartEntry): string {
    return [
        '[Desktop Entry]',
        'Type=Application',
        `Name=${escapeString(entry.name)}`,
        `Exec=${execLine(entry.commandline)}`,
        'X-GNOME-Autostart-enabled=true',
        `${OWNER_MARKER_KEY}=true`,
        '',
    ].join('\n');
}

/** True when `text` is a desktop file this package wrote: the marker, in the `[Desktop Entry]` group. */
export function isOwnedFile(text: string): boolean {
    let group = '';
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('[') && line.endsWith(']')) group = line;
        else if (group === '[Desktop Entry]' && line === `${OWNER_MARKER_KEY}=true`) return true;
    }
    return false;
}

// The file name is the app id, so an id that is a path would write outside the autostart directory.
const APP_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function autostartFileName(appId: string): string {
    if (!APP_ID.test(appId) || appId.includes('..')) {
        throw new RangeError(`"${appId}" is not usable as an autostart file name`);
    }
    return `${appId}.desktop`;
}

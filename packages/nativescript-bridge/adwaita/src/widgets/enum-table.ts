// The value table of a GIR enum that has no alias: each nick's POSITION is its constant, and the
// constant is spelled the way GIR spells it (`word-char` -> `WORD_CHAR`). One place, so the
// `Gtk.*` and `Adw.*` tables cannot disagree about it.

/** `word-char` -> `WORD_CHAR`, the spelling GIR gives a constant. */
type Snake<Nick extends string> = Nick extends `${infer Head}-${infer Tail}`
    ? `${Uppercase<Head>}_${Snake<Tail>}`
    : Uppercase<Nick>;

export function constantName(nick: string): string {
    return nick.toUpperCase().replaceAll('-', '_');
}

/** A value table for a no-alias enum: each nick's position is its constant. */
export function tableOf<const Nicks extends readonly string[]>(nicks: Nicks) {
    return Object.freeze(Object.fromEntries(nicks.map((nick, value) => [constantName(nick), value]))) as Readonly<{
        [Nick in Nicks[number] as Snake<Nick>]: number;
    }>;
}


/**
 * Which GNOME Online Accounts account an EDS source belongs to. The GOA extension sits on the
 * collection source, not on the calendar, so this walks up the parents until one carries it.
 * Pure over a structural source type so it runs without EDS.
 */

export interface GoaSourceLike {
    has_extension(name: string): boolean;
    get_extension(name: string): unknown;
    get_parent(): string | null;
}

export function goaAccountId(
    source: GoaSourceLike,
    lookup: (uid: string) => GoaSourceLike | null,
    goaExtension: string,
): string | null {
    let current: GoaSourceLike | null = source;
    const seen = new Set<string>();
    while (current) {
        if (current.has_extension(goaExtension)) {
            const id = (current.get_extension(goaExtension) as { get_account_id(): string | null }).get_account_id();
            return id || null;
        }
        const parent = current.get_parent();
        // A cycle in a broken registry must not hang the listing.
        if (!parent || seen.has(parent)) break;
        seen.add(parent);
        current = lookup(parent);
    }
    return null;
}

export interface NamedSource {
    id: string;
    name: string;
}

/** Same name for the reader: case and surrounding blanks do not tell two sources apart. */
function key(name: string): string {
    return name.trim().toLowerCase();
}

/**
 * Pure: the ids whose display name another source in the same list also carries. Only those rows
 * need a suffix; a name that is unique everywhere stays bare. The list spans all sections.
 */
export function duplicateNameIds(sources: readonly NamedSource[]): Set<string> {
    const count = new Map<string, number>();
    for (const s of sources) count.set(key(s.name), (count.get(key(s.name)) ?? 0) + 1);
    const ids = new Set<string>();
    for (const s of sources) if ((count.get(key(s.name)) ?? 0) > 1) ids.add(s.id);
    return ids;
}

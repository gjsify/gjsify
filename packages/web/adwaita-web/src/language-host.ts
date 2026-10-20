// What the browser knows of the user's languages, for `GLib.get_language_names()`: the ordered
// `navigator.languages`, or `navigator.language` where a host has only that. Read at CALL time, never
// at import — the user can change the list while the page is open, and a module may be evaluated where
// there is no `navigator` at all (SSR, a worker without one).

export function hostLanguageTags(): string[] {
    const host = typeof navigator === 'undefined' ? undefined : navigator;
    if (host?.languages && host.languages.length > 0) return [...host.languages];
    return host?.language ? [host.language] : [];
}

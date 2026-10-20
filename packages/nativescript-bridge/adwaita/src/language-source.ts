// The user's languages as BCP 47 tags — the base, for a host with none (the unit tests, a bundle for
// neither platform): no language is known, so `GLib.get_language_names()` answers `["C"]`. The platform
// variants sit beside this file (`.android.ts`, `.ios.ts`); the host that wraps them is
// `language-host.ts`. Read at CALL time; nothing here touches a platform global at import.

export function platformLanguageTags(): string[] {
    return [];
}

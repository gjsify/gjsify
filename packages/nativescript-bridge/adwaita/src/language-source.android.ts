// The user's languages on Android, best first: `LocaleList.getDefault()` (API 24, the minSdk), else the
// single `Locale.getDefault()`. `toLanguageTag()` gives BCP 47 (`de-DE`), not the legacy `de_DE`.
// Unverified on a device; the API is the documented one.

declare const android: any;
declare const java: any;

export function platformLanguageTags(): string[] {
    const tags: string[] = [];
    const list = typeof android === 'undefined' ? undefined : android.os?.LocaleList?.getDefault?.();
    if (list) {
        for (let i = 0; i < list.size(); i++) tags.push(String(list.get(i).toLanguageTag()));
    } else if (typeof java !== 'undefined') {
        tags.push(String(java.util.Locale.getDefault().toLanguageTag()));
    }
    return tags;
}

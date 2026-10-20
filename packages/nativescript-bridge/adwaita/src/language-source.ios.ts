// The user's languages on iOS: `NSLocale.preferredLanguages`, the user's ordered list of BCP 47 tags
// (`de-DE`, `zh-Hant-TW`). Unverified on a device; the API is the documented one.

declare const NSLocale: any;

export function platformLanguageTags(): string[] {
    if (typeof NSLocale === 'undefined') return [];
    const languages = NSLocale.preferredLanguages;
    const tags: string[] = [];
    for (let i = 0; i < (languages?.count ?? 0); i++) tags.push(String(languages.objectAtIndex(i)));
    return tags;
}

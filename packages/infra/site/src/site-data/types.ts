/** Operating systems a download can target. `web` covers the browser build and a self-hosting archive. */
export type TargetOs = 'linux' | 'darwin' | 'win32' | 'web' | 'android';

/** Browsers a WebExtension can target; the Chromium family counts as one. */
export type TargetBrowser = 'firefox' | 'chromium';

/** What a download group is keyed by: the OS a file runs on, or the browser an extension runs in. */
export type TargetPlatform = TargetOs | TargetBrowser;

/** `noarch` means one file serves every architecture (Flatpak, `.deb` "all", the web build). */
export type TargetArch = 'x86_64' | 'arm64' | 'noarch';

export type TargetFormat =
    | 'flathub'
    | 'flatpak'
    | 'appimage'
    | 'deb'
    | 'rpm'
    | 'msi'
    | 'zip'
    | 'dmg'
    | 'apk'
    | 'web'
    | 'store'
    | 'xpi'
    | 'source';

/**
 * Text with the untranslated source and any translations found in the metainfo. `source` is
 * written in the site's default language; `byLanguage` is keyed by BCP 47 tag as the metainfo
 * spells it (`de`, `pt-BR`).
 */
export interface Localized {
    source: string;
    byLanguage: Record<string, string>;
}

export type DescriptionBlock = { type: 'paragraph'; text: Localized } | { type: 'list'; items: Localized[] };

/** A plain link to a place that takes donations or sponsorship; `kind` is a msgid of the website catalogue. */
export interface SiteSupportLink {
    kind: string;
    url: string;
}

/** A SEPA bank transfer, shown as account details and an EPC QR code. The IBAN is stored normalised. */
export interface SiteSupportSepa {
    kind: 'sepa';
    name: string;
    iban: string;
    bic?: string;
    reference?: string;
}

export type SiteSupportEntry = SiteSupportLink | SiteSupportSepa;

export interface SiteLegalLink {
    label: string;
    url: string;
}

/**
 * `gjsify.site.privacy`: a consumer-authored statement of what the APP does with data — never
 * generated, because that claim is about the product's own code, not about this page. One file
 * per configured language, each checked independently rather than translated by the generator.
 */
export interface SitePrivacyConfig {
    /** `<lang>` (from `gjsify.site.languages`) → repo-relative path of that language's statement. */
    statements: Record<string, string>;
    /**
     * Link to the hoster's own data-processing notice, named in the page's built-in hosting
     * paragraph. Left out, nothing about hosting beyond what this package itself guarantees is
     * said — a provider is a per-deployment fact this package cannot derive.
     */
    hostingPolicyUrl?: string;
}

/**
 * `gjsify.site.legalNotice`: a consumer-authored "Legal Notice" / Impressum statement — one file per
 * configured language, like `privacy`. Unlike `privacy`, the content is typically IDENTICAL across a
 * publisher's apps (same legal entity, same address), but this package never assumes that: it reads
 * whatever each consumer's own file says, the same way `privacy` does. No built-in paragraph is added
 * — unlike the hosting disclosure on the privacy page, there is nothing this package itself can say
 * about who is legally responsible for a site's content.
 */
export interface SiteLegalNoticeConfig {
    /** `<lang>` (from `gjsify.site.languages`) → repo-relative path of that language's statement. */
    statements: Record<string, string>;
}

/**
 * One part of the product a person installs separately — a desktop app, the browser extension it
 * pairs with, a command line build. Declared in `gjsify.site.components`, in the order they are
 * installed, which is the order the download dialog explains them in.
 */
export interface SiteComponent {
    /** Referenced by `gjsify.site.downloads[].component`; also the `data-component` attribute. */
    id: string;
    /** English heading, translated through the website catalogue. */
    name: string;
    /** One sentence saying what this part is for and why it is needed. */
    summary?: string;
    /**
     * Release assets whose file name matches belong to this component. Anchor it, because the
     * first matching component in declaration order wins; a component without one takes whatever
     * is left, so the catch-all goes last.
     */
    match?: RegExp;
}

/** One entry of `gjsify.site.downloads`: a target the release assets cannot supply (a store page, the install docs). */
export interface SiteDownloadConfig {
    platform: TargetPlatform;
    format: TargetFormat;
    /** Required unless `available` is false. */
    url?: string;
    /** English label, translated through the website catalogue; a default exists per platform and format. */
    label?: string;
    /** False lists the target as "not yet available" without a link. Default true. */
    available: boolean;
    /** Id of the `gjsify.site.components` entry this target installs. */
    component?: string;
}

/**
 * One entry of `gjsify.site.relatedApps`: the site of another app, whose `app.json` is fetched at
 * build time. With `name` set it is an inline entry instead — for an app that publishes no
 * `app.json` (not built with gjsify) — and nothing is fetched.
 */
export interface SiteRelatedAppConfig {
    url: string;
    name?: string;
    summary?: string;
    icon?: string;
}

/**
 * `app.json`, published next to every site's `index.html` so other sites can list the app. Bump
 * `schema` on a breaking change; a reader ignores a schema it does not know.
 */
export interface AppManifest {
    schema: 1;
    id: string;
    /** Keyed by language, the metainfo's source text under `sourceLanguage`. */
    name: Record<string, string>;
    summary: Record<string, string>;
    /** Absolute URL of the app icon. */
    icon?: string;
    /** The site's own address. */
    url: string;
    /** Languages the site has pages for: `<url><lang>/` exists. */
    languages: string[];
    developer: { id?: string; name: string };
}

/** A related app as the page shows it: an `app.json` or an inline entry, validated. */
export interface RelatedApp {
    id?: string;
    name: Record<string, string>;
    summary: Record<string, string>;
    icon?: string;
    url: string;
    languages: string[];
}

/** The `gjsify.site` block of the root package.json, with defaults applied. */
export interface SiteConfig {
    metainfo: string;
    base: string;
    url: string;
    languages: string[];
    /** Language `/` falls back to when the visitor's languages match none of `languages`. */
    defaultLanguage: string;
    /** Language of the metainfo's untranslated text; the other languages are looked up in the catalogues. */
    sourceLanguage: string;
    repository: string;
    flathub?: string;
    webApp?: string;
    /** Directory holding the app's `<lang>.po` catalogues, used when the metainfo lacks a translation. */
    translations?: string;
    /**
     * Directory holding `<lang>.po` catalogues for the strings this configuration itself introduces —
     * the download labels. They overlay the page catalogues shipped with the renderer, which cannot
     * know a consumer's own copy.
     */
    pageTranslations?: string;
    /** Repo-relative app icon; defaults to the Flatpak or `ship` icon of the root package.json. */
    icon?: string;
    /**
     * The separately installed parts of the product, in install order. Empty for the common case of
     * one thing to download, which the dialog then lists without any component heading.
     */
    components: SiteComponent[];
    /** Extra download targets, added to the ones derived from the latest release. */
    downloads: SiteDownloadConfig[];
    /** False ignores the latest release's assets, so `downloads` is the whole list. Default true. */
    releaseAssets: boolean;
    support: SiteSupportEntry[];
    legal: SiteLegalLink[];
    /** A privacy/data-practices page at `/<lang>/privacy/`. `undefined`: no such page is built. */
    privacy?: SitePrivacyConfig;
    /** A Legal Notice / Impressum page at `/<lang>/legal-notice/`. `undefined`: no such page is built. */
    legalNotice?: SiteLegalNoticeConfig;
    /** Sites of other apps to list under "More apps by <developer>", in order. Empty: no section. */
    relatedApps: SiteRelatedAppConfig[];
}

/**
 * One entry of the metainfo `<screenshots>` list, with its artwork located on disk. The same images
 * Flathub shows, so the page is a preview of the store listing.
 */
export interface Screenshot {
    /** The metainfo caption, translated where the metainfo or a catalogue has a translation. */
    caption: Localized | null;
    /** The `<image>` URL, kept for reference. */
    url: string;
    /** Absolute path of the artwork: the repository's own file, or the downloaded copy. */
    file: string;
    /** Stem of the published renditions, derived from the URL path; also the key of the image map. */
    slug: string;
}

export interface Release {
    version: string;
    date: string;
    type?: string;
    description: DescriptionBlock[];
}

export interface DownloadTarget {
    /** The group the target belongs to: an operating system, or a browser for extensions. */
    os: TargetPlatform;
    arch: TargetArch;
    format: TargetFormat;
    /** Id of the `SiteComponent` this target installs; empty when the product has only one part. */
    component?: string;
    /** English label; the page translates it through the website catalogue. */
    label: string;
    /** Empty when the target is not available yet. */
    url: string;
    /** False for a target announced but not downloadable; it is listed, never recommended. */
    available: boolean;
    size?: number;
    downloadCount?: number;
    /** The one target to offer first for its OS. */
    recommended: boolean;
}

export interface ReleaseAsset {
    name: string;
    size: number;
    downloadUrl: string;
    downloadCount: number;
}

export interface LatestRelease {
    tag: string;
    name: string;
    publishedAt: string;
    url: string;
    assets: ReleaseAsset[];
}

export interface AgeRating {
    /** Minimum age in years, derived from the OARS attributes the way libappstream does. */
    minAge: number;
}

export interface Branding {
    light?: string;
    dark?: string;
}

export interface AppUrls {
    homepage?: string;
    bugtracker?: string;
    vcsBrowser?: string;
    translate?: string;
    donation?: string;
    help?: string;
    faq?: string;
    contact?: string;
    contribute?: string;
}

/** What the AppStream metainfo says, before any site configuration is mixed in. */
export interface Metainfo {
    id: string;
    name: Localized;
    summary: Localized;
    developer: { id?: string; name: string };
    description: DescriptionBlock[];
    /** Metainfo screenshots in document order; `url` is the remote image, kept for reference. */
    screenshots: Array<{ url: string; caption: Localized | null }>;
    releases: Release[];
    branding: Branding;
    urls: AppUrls;
    keywords: Localized[];
    categories: string[];
    projectLicense?: string;
    /** Licence of the metainfo text itself, which is what the page reproduces. */
    metadataLicense?: string;
    contentRating?: { type: string; attributes: Record<string, string> };
}

export interface Stats {
    /** Total installs reported by Flathub. */
    flathubInstalls?: number;
    flathubInstallsLastMonth?: number;
    /** Sum of GitHub release asset downloads for the latest release. */
    githubDownloads?: number;
}

export interface SiteData {
    config: SiteConfig;
    version: string;
    app: {
        id: string;
        name: Localized;
        summary: Localized;
        developer: { id?: string; name: string };
        description: DescriptionBlock[];
        license?: string;
        /** Licence of the text this page reproduces, as opposed to the app's own. */
        contentLicense?: string;
        keywords: Localized[];
        categories: string[];
        urls: AppUrls;
        branding: Branding;
        ageRating?: AgeRating;
        /** Repo-relative path to the app icon. */
        icon?: string;
    };
    screenshots: Screenshot[];
    releases: Release[];
    latestRelease: LatestRelease | null;
    downloads: {
        targets: DownloadTarget[];
        /** Always present: the fallback when no asset list could be fetched. */
        releasesUrl: string;
        /** False when GitHub confirmed there is no release yet; an unreachable API still counts as true. */
        hasReleases: boolean;
    };
    stats: Stats;
    /** Resolved `gjsify.site.relatedApps`, in configured order, without this site's own app. */
    relatedApps: RelatedApp[];
    /** Non-fatal problems met while collecting data, already logged. */
    warnings: string[];
}

import {
    AI_INVOLVEMENT_LEVELS,
    type AiInvolvement,
    type AiInvolvementLevel,
    type AppUrls,
    type Branding,
    type DescriptionBlock,
    type ImageUrls,
    type Localized,
    type Metainfo,
    type MetainfoScreenshot,
    type Release,
} from './types.js';
import { child, childrenNamed, parseXml, type XmlElement } from './xml.js';

const XML_LANG = 'xml:lang';

/**
 * Pairs sibling elements into texts: an element without `xml:lang` opens a new text, the ones with
 * `xml:lang` that follow translate it. This is how `msgfmt --xml` writes translated metainfo.
 */
export function groupLocalized(elements: readonly XmlElement[]): Localized[] {
    const groups: Localized[] = [];
    for (const element of elements) {
        const language = element.attrs[XML_LANG];
        if (language === undefined) {
            groups.push({ source: element.text, byLanguage: {} });
        } else {
            const current = groups.at(-1);
            if (current) current.byLanguage[language] = element.text;
        }
    }
    return groups;
}

function singleLocalized(parent: XmlElement, name: string): Localized | undefined {
    return groupLocalized(childrenNamed(parent, name))[0];
}

function parseBlocks(description: XmlElement | undefined): DescriptionBlock[] {
    const blocks: DescriptionBlock[] = [];
    if (!description) return blocks;

    let paragraphGroup: XmlElement[] = [];
    const flushParagraphs = () => {
        for (const text of groupLocalized(paragraphGroup)) blocks.push({ type: 'paragraph', text });
        paragraphGroup = [];
    };

    // Translations of a paragraph follow it directly, so consecutive `<p>` elements are grouped and
    // split again whenever a list interrupts them.
    for (const element of description.children) {
        if (element.name === 'p') {
            paragraphGroup.push(element);
        } else if (element.name === 'ul' || element.name === 'ol') {
            flushParagraphs();
            blocks.push({ type: 'list', items: groupLocalized(childrenNamed(element, 'li')) });
        }
    }
    flushParagraphs();
    return blocks;
}

function parseReleases(releases: XmlElement | undefined): Release[] {
    if (!releases) return [];
    return childrenNamed(releases, 'release').map((release) => {
        const timestamp = release.attrs.timestamp;
        const date =
            release.attrs.date ?? (timestamp ? new Date(Number(timestamp) * 1000).toISOString().slice(0, 10) : '');
        return {
            version: release.attrs.version ?? '',
            date,
            type: release.attrs.type,
            description: parseBlocks(child(release, 'description')),
        };
    });
}

/** The colours land in an inline `<style>`, so only plain hex values pass. */
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

function parseBranding(branding: XmlElement | undefined): Branding {
    const result: Branding = {};
    if (!branding) return result;
    for (const color of childrenNamed(branding, 'color')) {
        if (color.attrs.type !== 'primary' || !HEX_COLOR.test(color.text)) continue;
        if (color.attrs.scheme_preference === 'light') result.light = color.text;
        else if (color.attrs.scheme_preference === 'dark') result.dark = color.text;
    }
    return result;
}

const URL_KEYS: Record<string, keyof AppUrls> = {
    homepage: 'homepage',
    bugtracker: 'bugtracker',
    'vcs-browser': 'vcsBrowser',
    translate: 'translate',
    donation: 'donation',
    help: 'help',
    faq: 'faq',
    contact: 'contact',
    contribute: 'contribute',
    privacy: 'privacy',
};

/** Links are rendered as `href`, so `javascript:` and friends are dropped. */
const SAFE_URL = /^(https?:|mailto:)/i;

function parseUrls(component: XmlElement): AppUrls {
    const urls: AppUrls = {};
    for (const url of childrenNamed(component, 'url')) {
        const key = URL_KEYS[url.attrs.type ?? ''];
        if (key && SAFE_URL.test(url.text)) urls[key] = url.text;
    }
    return urls;
}

/** The `<image>`s of a `<screenshot>`: the untagged one, and the `xml:lang` ones as translations of it. */
function parseImages(screenshot: XmlElement): ImageUrls {
    const pick = (images: XmlElement[]) => (images.find((image) => image.attrs.type === 'source') ?? images[0])?.text;
    const images = childrenNamed(screenshot, 'image');
    const byLanguage: Record<string, string> = {};
    for (const language of new Set(images.map((image) => image.attrs[XML_LANG]))) {
        if (language === undefined) continue;
        const url = pick(images.filter((image) => image.attrs[XML_LANG] === language));
        if (url) byLanguage[language] = url;
    }
    return { url: pick(images.filter((image) => image.attrs[XML_LANG] === undefined)) ?? '', byLanguage };
}

/** AppStream's `environment="gnome:dark"`: the screenshot shows the app in its dark style. */
function isDark(screenshot: XmlElement): boolean {
    return (screenshot.attrs.environment ?? '').endsWith(':dark');
}

/** The file name of an image URL without extension, query, `dark`/`light` marker or case: `…/Popup-dark.png` → `popup`. */
function imageStem(url: string): string {
    const name = (url.split(/[?#]/)[0] ?? '').split('/').at(-1) ?? '';
    return name
        .replace(/\.[^.]+$/, '')
        .toLowerCase()
        .replace(/(^|[-_.])(dark|light)(?=$|[-_.])/g, '')
        .replace(/^[-_.]+|[-_.]+$/g, '');
}

/**
 * A dark screenshot is the dark twin of the light one with the same image name (`popup.png` and
 * `popup-dark.png`), else of the one with the same caption, and never a slide of its own. Only a
 * metainfo where no dark screenshot can be identified that way is paired by document order. A dark
 * screenshot without a partner is dropped with a warning rather than attached to an arbitrary one.
 */
function parseScreenshots(screenshots: XmlElement[], warn: (message: string) => void): MetainfoScreenshot[] {
    const light = screenshots.filter((screenshot) => !isDark(screenshot));
    const result: MetainfoScreenshot[] = light.map((screenshot) => ({
        ...parseImages(screenshot),
        caption: singleLocalized(screenshot, 'caption') ?? null,
    }));
    const darks = screenshots.filter(isDark);
    const claimed = new Set<number>();
    const identify = (dark: XmlElement): number => {
        const images = parseImages(dark);
        const stem = imageStem(images.url);
        const caption = singleLocalized(dark, 'caption')?.source;
        const free = (index: number) => !claimed.has(index);
        const byName =
            stem === '' ? -1 : result.findIndex((shot, index) => free(index) && imageStem(shot.url) === stem);
        if (byName !== -1) return byName;
        if (!caption) return -1;
        return result.findIndex((shot, index) => free(index) && shot.caption?.source === caption);
    };

    const partners = darks.map((dark) => {
        const index = identify(dark);
        if (index !== -1) claimed.add(index);
        return index;
    });
    const byOrder = partners.every((index) => index === -1);

    for (const [n, dark] of darks.entries()) {
        const index = byOrder ? n : partners[n]!;
        const partner = result[index];
        if (partner && index !== -1) partner.dark = parseImages(dark);
        else warn(`Dark screenshot ${n + 1} of the metainfo has no light screenshot to pair with; dropping it`);
    }
    return result;
}

/**
 * The `gjsify::ai-*` values of `<custom>` (ADR 0153). AppStream refuses a repeated key, so the
 * disclosure is one untranslated sentence; the site translates it through the app's catalogues.
 * Without a valid level nothing is shown: no fact is guessed.
 */
function parseAiInvolvement(component: XmlElement, warn: (message: string) => void): AiInvolvement | undefined {
    const values: Record<string, string> = {};
    for (const value of childrenNamed(child(component, 'custom') ?? component, 'value')) {
        const key = value.attrs.key;
        if (key?.startsWith('gjsify::ai-') && value.attrs[XML_LANG] === undefined && values[key] === undefined)
            values[key] = value.text;
    }
    const level = values['gjsify::ai-involvement'];
    const disclosure = values['gjsify::ai-disclosure'];
    if (level === undefined) {
        if (disclosure !== undefined)
            warn('The metainfo has gjsify::ai-disclosure without gjsify::ai-involvement; showing nothing');
        return undefined;
    }
    if (!(AI_INVOLVEMENT_LEVELS as readonly string[]).includes(level)) {
        warn(
            `Unknown gjsify::ai-involvement "${level}" (expected ${AI_INVOLVEMENT_LEVELS.join(', ')}); showing nothing`,
        );
        return undefined;
    }
    return {
        level: level as AiInvolvementLevel,
        disclosure: disclosure ? { source: disclosure, byLanguage: {} } : undefined,
    };
}

/** Reads the parts of an AppStream `<component>` the landing page needs. */
export function parseMetainfo(xml: string, warn: (message: string) => void = () => {}): Metainfo {
    const component = parseXml(xml);
    if (component.name !== 'component') throw new Error(`Metainfo root must be <component>, got <${component.name}>`);

    const id = child(component, 'id')?.text;
    if (!id) throw new Error('Metainfo has no <id>');
    const name = singleLocalized(component, 'name');
    if (!name) throw new Error('Metainfo has no <name>');
    const summary = singleLocalized(component, 'summary') ?? { source: '', byLanguage: {} };

    const developer = child(component, 'developer');
    const developerName = developer ? child(developer, 'name')?.text : undefined;

    const screenshots = parseScreenshots(
        childrenNamed(child(component, 'screenshots') ?? component, 'screenshot'),
        warn,
    );

    const contentRating = child(component, 'content_rating');
    const attributes: Record<string, string> = {};
    for (const attribute of contentRating ? childrenNamed(contentRating, 'content_attribute') : []) {
        if (attribute.attrs.id) attributes[attribute.attrs.id] = attribute.text;
    }

    return {
        id,
        name,
        summary,
        developer: { id: developer?.attrs.id, name: developerName ?? '' },
        description: parseBlocks(child(component, 'description')),
        screenshots,
        releases: parseReleases(child(component, 'releases')),
        branding: parseBranding(child(component, 'branding')),
        urls: parseUrls(component),
        keywords: groupLocalized(childrenNamed(child(component, 'keywords') ?? component, 'keyword')),
        categories: childrenNamed(child(component, 'categories') ?? component, 'category').map(
            (category) => category.text,
        ),
        projectLicense: child(component, 'project_license')?.text,
        metadataLicense: child(component, 'metadata_license')?.text,
        contentRating: contentRating ? { type: contentRating.attrs.type ?? '', attributes } : undefined,
        aiInvolvement: parseAiInvolvement(component, warn),
    };
}

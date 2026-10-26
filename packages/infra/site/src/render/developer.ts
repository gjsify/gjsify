/**
 * A developer site: the hub at `/<lang>/` — who the person is, the apps they publish, the latest
 * posts — and the CV at `/<lang>/cv/`, both from a JSON Resume file per language (ADR 0120 §3).
 * The support, privacy and legal-notice pages are the app site's, under the person's name.
 */
import type {
    DeveloperData,
    Resume,
    ResumeEducation,
    ResumeProfile,
    ResumeProject,
    ResumeWork,
} from '../site-data/index.js';
import { blogFeedUrl, blogIndexUrl } from './blog.js';
import { esc, fmt, plain } from './html.js';
import { icon, type IconName } from './icons.js';
import {
    absoluteUrl,
    documentPage,
    githubUrl,
    simplePage,
    sitePageUrl,
    type ClientAssets,
    type NavLink,
    type PageMeta,
    type Shell,
    type Translate,
} from './layout.js';
import { renderMarkdown } from './markdown.js';
import { hostingNotice, linkCard, relatedCard, supportList } from './pages.js';
import { personJsonLd } from './seo.js';

export interface DeveloperContext {
    data: DeveloperData;
    lang: string;
    t: Translate;
    assets: ClientAssets;
    /** Published URL of `basics.image`: the avatar, the favicon and the bar brand. */
    avatarUrl?: string;
    displayFontUrl?: string;
    /** Root-relative URL of the link-preview card for this language. */
    ogImage?: string;
}

export type DeveloperView = 'home' | 'cv' | 'support' | 'privacy' | 'legal-notice';

const VIEW_PATHS: Record<DeveloperView, string> = {
    home: '',
    cv: 'cv/',
    support: 'support/',
    privacy: 'privacy/',
    'legal-notice': 'legal-notice/',
};

export function developerPageUrl(ctx: Pick<DeveloperContext, 'data'>, lang: string, view: DeveloperView): string {
    return sitePageUrl(ctx.data.config, lang, VIEW_PATHS[view]);
}

function resume(ctx: DeveloperContext): Resume {
    return ctx.data.resumes[ctx.lang]!;
}

export function developerShell(ctx: DeveloperContext, current?: 'blog' | 'cv'): Shell {
    const { data, lang, t } = ctx;
    const { config } = data;
    const name = resume(ctx).basics.name;
    const nav: NavLink[] = [
        ...(config.blog
            ? [
                  {
                      href: blogIndexUrl(config, lang),
                      label: t('Blog'),
                      glyph: 'blog' as const,
                      current: current === 'blog',
                  },
              ]
            : []),
        { href: developerPageUrl(ctx, lang, 'cv'), label: t('CV'), glyph: 'cv', current: current === 'cv' },
    ];
    return {
        config,
        lang,
        t,
        assets: ctx.assets,
        name,
        home: developerPageUrl(ctx, lang, 'home'),
        iconUrl: ctx.avatarUrl,
        // No metainfo `<branding>` to read, so the accent is the developer's colour.
        branding: config.theme.accent ?? {},
        repository: githubUrl(config.repository),
        licenses: [],
        nav,
        feeds: config.blog ? [{ title: `${name} – ${t('Blog')}`, href: blogFeedUrl(config, lang) }] : [],
        displayFontUrl: ctx.displayFontUrl,
    };
}

function pageMetaFor(ctx: DeveloperContext, view: DeveloperView, title: string, description: string): PageMeta {
    const { config } = ctx.data;
    return {
        title,
        description,
        urls: Object.fromEntries(config.languages.map((code) => [code, developerPageUrl(ctx, code, view)])),
        ogType: view === 'home' || view === 'cv' ? 'profile' : 'website',
        ogImage: ctx.ogImage,
    };
}

const PROFILE_GLYPHS: Record<string, IconName> = {
    github: 'code',
    gitlab: 'code',
    codeberg: 'code',
    sourcehut: 'code',
    mastodon: 'people',
    linkedin: 'people',
    xing: 'people',
    email: 'mail',
};

function profileGlyph(profile: ResumeProfile): IconName {
    return PROFILE_GLYPHS[profile.network.toLowerCase()] ?? 'external';
}

function profileLinks(profiles: readonly ResumeProfile[]): string[] {
    return profiles
        .filter((profile) => profile.url)
        .map((profile) => linkCard(profile.url!, profile.network, profileGlyph(profile)));
}

/** The words a search result shows: the label and the start of the summary. */
function developerDescription(resume: Resume): string {
    const { label, summary, name } = resume.basics;
    const text = [label, summary].filter(Boolean).join(' – ');
    if (!text) return name;
    return text.length <= 160 ? text : `${text.slice(0, 159).replace(/\s+\S*$/, '')}…`;
}

function hero(ctx: DeveloperContext): string {
    const { basics } = resume(ctx);
    const avatar = ctx.avatarUrl
        ? `<div class="hero-icon developer-avatar"><img src="${esc(ctx.avatarUrl)}" alt="" width="128" height="128"></div>`
        : '';
    return `<header class="masthead">
<div class="hero-inner">
${avatar}
<div class="hero-text">
<h1>${esc(basics.name)}</h1>
${basics.label ? `<p class="hero-by">${esc(basics.label)}</p>` : ''}
</div>
</div>
</header>`;
}

/** `/<lang>/`: the person, their apps, their latest posts. */
export function renderDeveloperHome(ctx: DeveloperContext, latestPosts = ''): string {
    const { data, lang, t } = ctx;
    const cv = resume(ctx);
    const { basics } = cv;
    const description = developerDescription(cv);
    const page = pageMetaFor(ctx, 'home', basics.label ? `${basics.name} – ${basics.label}` : basics.name, description);
    page.jsonLd = personJsonLd({
        name: basics.name,
        url: absoluteUrl(data.config, developerPageUrl(ctx, lang, 'home')),
        jobTitle: basics.label,
        description: basics.summary,
        image: ctx.avatarUrl ? absoluteUrl(data.config, ctx.avatarUrl) : undefined,
        sameAs: basics.profiles.flatMap((profile) => (profile.url ? [profile.url] : [])),
    });
    const profiles = profileLinks(basics.profiles);
    const apps =
        data.apps.length > 0
            ? `<section class="related developer-apps">
<h2>${esc(t('Apps'))}</h2>
<ul class="related-list">
${data.apps.map((app) => relatedCard(app, lang)).join('\n')}
</ul>
</section>`
            : '';
    const support =
        data.config.support.length > 0
            ? `<section class="support">
<a class="button support-cta" href="${esc(developerPageUrl(ctx, lang, 'support'))}">${icon('heart')}<span>${esc(t('Support my work'))}</span></a>
</section>`
            : '';
    return documentPage(
        developerShell(ctx),
        page,
        `${hero(ctx)}
<main>
<div class="column">
<section class="about">
${basics.summary ? renderMarkdown(basics.summary) : ''}
<p class="developer-cv"><a class="button" href="${esc(developerPageUrl(ctx, lang, 'cv'))}">${icon('cv')}<span>${esc(t('Read my CV'))}</span></a></p>
</section>
${apps}
${latestPosts}
${support}
${profiles.length > 0 ? `<section class="links">\n<h2>${esc(t('Elsewhere'))}</h2>\n<ul class="card-list">\n${profiles.join('\n')}\n</ul>\n</section>` : ''}
</div>
</main>`,
        'developer',
    );
}

/** `2024-03` → "March 2024" in the reader's language; a bare year stays a year. */
export function formatResumeDate(date: string, lang: string): string {
    const [year, month] = date.split('-');
    if (!month) return year!;
    return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
    );
}

function period(start: string | undefined, end: string | undefined, lang: string, t: Translate): string {
    if (!start && !end) return '';
    const from = start ? formatResumeDate(start, lang) : '';
    const to = end ? formatResumeDate(end, lang) : t('today');
    const text = from ? `${from} – ${to}` : to;
    return `<p class="cv-period">${start ? `<time datetime="${esc(start)}">` : ''}${esc(text)}${start ? '</time>' : ''}</p>`;
}

function highlights(items: readonly string[]): string {
    return items.length > 0
        ? `<ul class="cv-highlights">${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
        : '';
}

function titled(name: string, url: string | undefined): string {
    return url ? `<a href="${esc(url)}">${esc(name)}</a>` : esc(name);
}

function workEntry(work: ResumeWork, lang: string, t: Translate): string {
    return `<li class="cv-entry">
<h3>${work.position ? `${esc(work.position)} · ` : ''}${titled(work.name, work.url)}</h3>
${period(work.startDate, work.endDate, lang, t)}
${work.summary ? `<p>${esc(work.summary)}</p>` : ''}
${highlights(work.highlights)}
</li>`;
}

function projectEntry(project: ResumeProject, lang: string, t: Translate): string {
    return `<li class="cv-entry">
<h3>${titled(project.name, project.url)}</h3>
${period(project.startDate, project.endDate, lang, t)}
${project.description ? `<p>${esc(project.description)}</p>` : ''}
${highlights(project.highlights)}
${project.keywords.length > 0 ? `<ul class="tags">${project.keywords.map((keyword) => `<li>${esc(keyword)}</li>`).join('')}</ul>` : ''}
</li>`;
}

function educationEntry(education: ResumeEducation, lang: string, t: Translate): string {
    const what = [education.studyType, education.area].filter(Boolean).join(', ');
    return `<li class="cv-entry">
<h3>${what ? `${esc(what)} · ` : ''}${titled(education.institution, education.url)}</h3>
${period(education.startDate, education.endDate, lang, t)}
</li>`;
}

function cvSection(className: string, heading: string, items: readonly string[]): string {
    if (items.length === 0) return '';
    return `<section class="cv-section ${className}">
<h2>${esc(heading)}</h2>
<ul class="cv-list">
${items.join('\n')}
</ul>
</section>`;
}

/** `/<lang>/cv/`: the résumé, one column on screen, without the site's chrome on paper. */
export function renderCv(ctx: DeveloperContext): string {
    const { lang, t } = ctx;
    const cv = resume(ctx);
    const { basics } = cv;
    const location = [basics.location?.city, basics.location?.region].filter(Boolean).join(', ');
    const contact = [
        basics.email ? `<li>${icon('mail')}<a href="mailto:${esc(basics.email)}">${esc(basics.email)}</a></li>` : '',
        basics.url
            ? `<li>${icon('web')}<a href="${esc(basics.url)}">${esc(basics.url.replace(/^https?:\/\/|\/$/g, ''))}</a></li>`
            : '',
        location ? `<li>${esc(location)}</li>` : '',
        ...basics.profiles
            .filter((profile) => profile.url)
            .map(
                (profile) =>
                    `<li>${icon(profileGlyph(profile))}<a href="${esc(profile.url!)}">${esc(profile.username ?? profile.network)}</a></li>`,
            ),
    ].filter(Boolean);
    const skills = cv.skills.map(
        (skill) =>
            `<li class="cv-entry"><h3>${esc(skill.name)}</h3>${skill.keywords.length > 0 ? `<ul class="tags">${skill.keywords.map((keyword) => `<li>${esc(keyword)}</li>`).join('')}</ul>` : ''}</li>`,
    );
    const languages = cv.languages.map(
        (language) =>
            `<li class="cv-entry"><h3>${esc(language.language)}</h3>${language.fluency ? `<p>${esc(language.fluency)}</p>` : ''}</li>`,
    );
    const page = pageMetaFor(
        ctx,
        'cv',
        `${t('CV')} – ${basics.name}`,
        plain(t('Experience, projects and skills of {name}.'), { name: basics.name }),
    );
    return documentPage(
        developerShell(ctx, 'cv'),
        page,
        `<main>
<article class="column cv">
<header class="cv-head">
${ctx.avatarUrl ? `<img class="cv-avatar" src="${esc(ctx.avatarUrl)}" alt="" width="96" height="96">` : ''}
<div>
<h1>${esc(basics.name)}</h1>
${basics.label ? `<p class="cv-label">${esc(basics.label)}</p>` : ''}
${contact.length > 0 ? `<ul class="cv-contact">${contact.join('')}</ul>` : ''}
</div>
</header>
${basics.summary ? `<section class="cv-section cv-summary">${renderMarkdown(basics.summary)}</section>` : ''}
${cvSection(
    'cv-work',
    t('Experience'),
    cv.work.map((work) => workEntry(work, lang, t)),
)}
${cvSection(
    'cv-projects',
    t('Projects'),
    cv.projects.map((project) => projectEntry(project, lang, t)),
)}
${cvSection(
    'cv-education',
    t('Education'),
    cv.education.map((education) => educationEntry(education, lang, t)),
)}
${cvSection('cv-skills', t('Skills'), skills)}
${cvSection('cv-languages', t('Languages'), languages)}
</article>
</main>`,
        'cv-page',
    );
}

function back(ctx: DeveloperContext): { href: string; label: string } {
    return {
        href: developerPageUrl(ctx, ctx.lang, 'home'),
        label: fmt(ctx.t('Back to {app}'), { app: resume(ctx).basics.name }),
    };
}

export function renderDeveloperSupportPage(ctx: DeveloperContext): string {
    const { data, t } = ctx;
    const name = resume(ctx).basics.name;
    const description = plain(t('{name} writes free software. Support the work with a transfer or a service.'), {
        name,
    });
    return simplePage(developerShell(ctx), pageMetaFor(ctx, 'support', `${t('Support')} – ${name}`, description), {
        heading: t('Support'),
        byline: name,
        body: `<p class="support-intro">${esc(description)}</p>
${supportList(data.config.support, t, name)}`,
        back: back(ctx),
    });
}

export function renderDeveloperPrivacyPage(ctx: DeveloperContext, statement: string): string {
    const { t } = ctx;
    const name = resume(ctx).basics.name;
    return simplePage(
        developerShell(ctx),
        pageMetaFor(ctx, 'privacy', `${t('Privacy')} – ${name}`, plain(t('What {app} does with data.'), { app: name })),
        {
            heading: t('Privacy'),
            byline: name,
            columnClass: 'privacy-statement',
            body: `${hostingNotice(ctx.data.config, t)}\n${renderMarkdown(statement)}`,
            back: back(ctx),
        },
    );
}

export function renderDeveloperLegalNoticePage(ctx: DeveloperContext, statement: string): string {
    const { t } = ctx;
    const name = resume(ctx).basics.name;
    return simplePage(
        developerShell(ctx),
        pageMetaFor(
            ctx,
            'legal-notice',
            `${t('Legal Notice')} – ${name}`,
            plain(t('Who publishes {app}, and how to reach them.'), { app: name }),
        ),
        {
            heading: t('Legal Notice'),
            byline: name,
            columnClass: 'privacy-statement',
            body: renderMarkdown(statement),
            back: back(ctx),
        },
    );
}

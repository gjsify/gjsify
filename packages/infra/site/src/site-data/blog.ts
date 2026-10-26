import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { parseFrontmatter } from './frontmatter.js';

export interface BlogPost {
    slug: string;
    lang: string;
    title: string;
    /** As written: YYYY-MM-DD or a full ISO 8601 date-time. */
    date: string;
    updated?: string;
    summary?: string;
    tags: string[];
    draft: boolean;
    /** Markdown body without frontmatter. */
    body: string;
    /** Absolute path of the .md file. */
    file: string;
}

export interface LoadBlogOptions {
    dir: string;
    languages: readonly string[];
    drafts: boolean;
}

/** `YYYY-MM-DD` or an ISO 8601 date-time; anything else is a typo the build should name. */
function validateDate(date: string, file: string, key: string): void {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(date);
    const dateTime = /^\d{4}-\d{2}-\d{2}T/.test(date);
    if ((!dateOnly && !dateTime) || Number.isNaN(new Date(dateOnly ? `${date}T00:00:00Z` : date).getTime())) {
        throw new Error(`${file}: ${key} "${date}" is not YYYY-MM-DD or an ISO 8601 date-time`);
    }
}

function isValidSlug(slug: string): boolean {
    return /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

async function walkDir(dir: string, result: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            // Skip dotdirs
            if (entry.name.startsWith('.')) {
                continue;
            }
            await walkDir(fullPath, result);
        } else if (entry.isFile()) {
            if (entry.name.startsWith('.')) {
                continue;
            }
            result.push(fullPath);
        }
    }
}

/** Every post under `dir` (recursive), newest first (ties: slug ascending, then lang). */
export async function loadBlogPosts(options: LoadBlogOptions): Promise<BlogPost[]> {
    const { dir, languages, drafts } = options;
    if (!existsSync(dir)) {
        throw new Error(`blog.posts: ${dir} does not exist`);
    }

    const allFiles: string[] = [];
    await walkDir(dir, allFiles);

    const posts: BlogPost[] = [];
    const seen = new Map<string, string>(); // key slug+lang -> file

    for (const file of allFiles) {
        const basename = file.split(sep).pop() || file;
        // skip README.md case-insensitively
        if (basename.toLowerCase() === 'readme.md') {
            continue;
        }
        if (!basename.endsWith('.md')) {
            continue;
        }
        if (basename.startsWith('.')) {
            continue;
        }

        const content = await readFile(file, 'utf-8');
        const parsed = parseFrontmatter(content, file);

        // Determine slug and lang
        let slug: string | undefined;
        let lang: string | undefined;

        // Try filename pattern <slug>.<lang>.md
        const match = basename.match(/^(.+)\.([^.]+)\.md$/);
        if (match) {
            const maybeSlug = match[1]!;
            const maybeLang = match[2]!;
            if (languages.includes(maybeLang)) {
                slug = maybeSlug;
                lang = maybeLang;
            }
        }

        // frontmatter overrides
        if (parsed.data.slug !== undefined) {
            if (typeof parsed.data.slug === 'string') {
                slug = parsed.data.slug;
            } else {
                throw new Error(`${file}: slug must be a string`);
            }
        }
        if (parsed.data.lang !== undefined) {
            if (typeof parsed.data.lang === 'string') {
                lang = parsed.data.lang;
            } else {
                throw new Error(`${file}: lang must be a string`);
            }
        }

        if (lang === undefined || slug === undefined) {
            throw new Error(`${file}: no language — name the file <slug>.<lang>.md or set "lang" in the frontmatter`);
        }
        if (!languages.includes(lang)) {
            throw new Error(`${file}: lang ${lang} not in allowed list [${languages.join(', ')}]`);
        }
        if (!isValidSlug(slug)) {
            throw new Error(`${file}: invalid slug ${slug}`);
        }

        // Check duplicates
        const key = `${slug}\u0000${lang}`;
        if (seen.has(key)) {
            throw new Error(`${file}: duplicate slug+lang with ${seen.get(key)}`);
        }
        seen.set(key, file);

        // Check unknown frontmatter keys
        const allowedKeys = new Set(['slug', 'lang', 'title', 'date', 'updated', 'summary', 'tags', 'draft']);
        for (const k of Object.keys(parsed.data)) {
            if (!allowedKeys.has(k)) {
                throw new Error(`${file}: unknown frontmatter key ${k}`);
            }
        }

        // Required
        if (typeof parsed.data.title !== 'string') {
            throw new Error(`${file}: title must be a string`);
        }
        if (typeof parsed.data.date !== 'string') {
            throw new Error(`${file}: date must be a string`);
        }
        validateDate(parsed.data.date, file, 'date');

        if (parsed.data.updated !== undefined) {
            if (typeof parsed.data.updated !== 'string') {
                throw new Error(`${file}: updated must be a string`);
            }
            validateDate(parsed.data.updated, file, 'updated');
        }
        if (parsed.data.summary !== undefined && typeof parsed.data.summary !== 'string') {
            throw new Error(`${file}: summary must be a string`);
        }

        let tags: string[] = [];
        if (parsed.data.tags !== undefined) {
            if (typeof parsed.data.tags === 'string') {
                tags = [parsed.data.tags];
            } else if (Array.isArray(parsed.data.tags)) {
                tags = parsed.data.tags.map((t) => String(t));
            } else {
                throw new Error(`${file}: tags must be string[]`);
            }
        }

        let draft = false;
        if (parsed.data.draft !== undefined) {
            if (typeof parsed.data.draft === 'boolean') {
                draft = parsed.data.draft;
            } else {
                throw new Error(`${file}: draft must be boolean`);
            }
        }

        if (draft && !drafts) {
            continue;
        }

        posts.push({
            slug,
            lang,
            title: parsed.data.title,
            date: parsed.data.date,
            updated: parsed.data.updated as string | undefined,
            summary: parsed.data.summary as string | undefined,
            tags,
            draft,
            body: parsed.body,
            file,
        });
    }

    // newest first (ties: slug ascending, then lang)
    posts.sort((a, b) => {
        const ta = postTime(a.date);
        const tb = postTime(b.date);
        if (tb !== ta) {
            return tb - ta;
        }
        if (a.slug !== b.slug) {
            return a.slug < b.slug ? -1 : 1;
        }
        if (a.lang !== b.lang) {
            return a.lang < b.lang ? -1 : 1;
        }
        return 0;
    });

    return posts;
}

/** Posts with the same slug in the other languages. */
export function translationsOf(posts: readonly BlogPost[], post: BlogPost): BlogPost[] {
    return posts.filter((p) => p.slug === post.slug && p.lang !== post.lang);
}

/** Paths relative to dir (POSIX separators) of every non-.md file under dir, recursive, sorted. Skips dotfiles/dot-dirs. */
export async function blogAssetFiles(dir: string): Promise<string[]> {
    const allFiles: string[] = [];
    await walkDir(dir, allFiles);
    const result: string[] = [];
    for (const file of allFiles) {
        const basename = file.split(sep).pop() || file;
        if (basename.startsWith('.')) {
            continue;
        }
        if (basename.endsWith('.md')) {
            continue;
        }
        const rel = relative(dir, file).split(sep).join('/');
        result.push(rel);
    }
    result.sort();
    return result;
}

/** URL-safe tag slug: lowercase, NFKD with diacritics removed, runs of non [a-z0-9] → '-', trimmed of '-'. Throws if the result is empty. */
export function tagSlug(tag: string): string {
    // NFKD normalization
    const normalized = tag.normalize('NFKD');
    // Remove diacritics
    const withoutDiacritics = normalized.replace(/[\u0300-\u036f]/g, '');
    const lower = withoutDiacritics.toLowerCase();
    const slug = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (slug === '') {
        throw new Error('empty tag slug');
    }
    return slug;
}

/** Milliseconds since epoch for sorting/feeds; a date-only value means 00:00 UTC. */
export function postTime(date: string): number {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const d = new Date(date + 'T00:00:00Z');
        return d.getTime();
    }
    const d = new Date(date);
    return d.getTime();
}

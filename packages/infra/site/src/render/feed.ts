import { esc } from './html.js';

export interface FeedEntry {
    id: string;
    url: string;
    title: string;
    published: string;
    updated?: string;
    summary?: string;
    contentHtml: string;
    tags: readonly string[];
}

export interface FeedInfo {
    id: string;
    title: string;
    subtitle?: string;
    selfUrl: string;
    siteUrl: string;
    lang: string;
    author: {
        name: string;
        uri?: string;
    };
    icon?: string;
}

function formatDateRFC3339(date: string): string {
    // date-only YYYY-MM-DD means 00:00:00Z
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return date + 'T00:00:00Z';
    }
    // Try to parse as ISO date-time
    const d = new Date(date);
    if (isNaN(d.getTime())) {
        // Fallback: if it looks like ISO, try to normalize
        // Otherwise just append Z if no timezone?
        return date;
    }
    // Format as RFC3339 UTC
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A complete Atom document. Dates are given as YYYY-MM-DD or ISO; output RFC 3339 (date-only → T00:00:00Z). Feed <updated> = newest entry updated/published, or 1970-01-01T00:00:00Z when empty. */
export function atomFeed(info: FeedInfo, entries: readonly FeedEntry[]): string {
    let feedUpdated = '1970-01-01T00:00:00Z';
    if (entries.length > 0) {
        let newest = -Infinity;
        for (const entry of entries) {
            const updatedDate = entry.updated ?? entry.published;
            const t = formatDateRFC3339(updatedDate);
            // For comparison, use Date
            const d = new Date(t);
            if (d.getTime() > newest) {
                newest = d.getTime();
                feedUpdated = t.endsWith('Z') && t.includes('T') && t.length > 10 ? t : formatDateRFC3339(updatedDate);
                // ensure proper format
                if (!feedUpdated.includes('T')) {
                    feedUpdated = feedUpdated + 'T00:00:00Z';
                } else if (!feedUpdated.endsWith('Z') && !feedUpdated.match(/[+-]\d{2}:?\d{2}$/)) {
                    // try to convert
                    feedUpdated = new Date(feedUpdated).toISOString().replace(/\.\d{3}Z$/, 'Z');
                }
            }
        }
        // Recompute properly
        let maxTime = -Infinity;
        let maxStr = '1970-01-01T00:00:00Z';
        for (const entry of entries) {
            const updatedDate = entry.updated ?? entry.published;
            const formatted = formatDateRFC3339(updatedDate);
            const d = new Date(formatted);
            if (!isNaN(d.getTime()) && d.getTime() > maxTime) {
                maxTime = d.getTime();
                maxStr = formatted.includes('T') ? formatted : formatted + 'T00:00:00Z';
                if (maxStr.match(/\.\d{3}Z$/)) {
                    maxStr = maxStr.replace(/\.\d{3}Z$/, 'Z');
                }
            }
        }
        feedUpdated = maxStr;
    }

    let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
    xml += `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${esc(info.lang)}">\n`;
    xml += `  <id>${esc(info.id)}</id>\n`;
    xml += `  <title>${esc(info.title)}</title>\n`;
    if (info.subtitle) {
        xml += `  <subtitle>${esc(info.subtitle)}</subtitle>\n`;
    }
    xml += `  <updated>${feedUpdated}</updated>\n`;
    xml += `  <link rel="self" type="application/atom+xml" href="${esc(info.selfUrl)}"/>\n`;
    xml += `  <link rel="alternate" type="text/html" href="${esc(info.siteUrl)}"/>\n`;
    if (info.icon) {
        xml += `  <icon>${esc(info.icon)}</icon>\n`;
    }
    xml += `  <author>\n`;
    xml += `    <name>${esc(info.author.name)}</name>\n`;
    if (info.author.uri) {
        xml += `    <uri>${esc(info.author.uri)}</uri>\n`;
    }
    xml += `  </author>\n`;

    for (const entry of entries) {
        xml += `  <entry>\n`;
        xml += `    <id>${esc(entry.id)}</id>\n`;
        xml += `    <title>${esc(entry.title)}</title>\n`;
        xml += `    <link rel="alternate" href="${esc(entry.url)}"/>\n`;
        const published = formatDateRFC3339(entry.published);
        xml += `    <published>${published.includes('T') ? published.replace(/\.\d{3}Z$/, 'Z') : published + 'T00:00:00Z'}</published>\n`;
        const updated = entry.updated ? formatDateRFC3339(entry.updated) : published;
        const updatedOut = updated.includes('T') ? updated.replace(/\.\d{3}Z$/, 'Z') : updated + 'T00:00:00Z';
        xml += `    <updated>${updatedOut}</updated>\n`;
        if (entry.summary) {
            xml += `    <summary>${esc(entry.summary)}</summary>\n`;
        }
        xml += `    <content type="html">${esc(entry.contentHtml)}</content>\n`;
        for (const tag of entry.tags) {
            xml += `    <category term="${esc(tag)}"/>\n`;
        }
        xml += `  </entry>\n`;
    }

    xml += `</feed>`;
    return xml;
}

import type { StoreEntry } from '../listing/build.js';
import type { StoreFiles, StoreManifest } from '../listing/store-json.js';
import { esc } from './html.js';

export interface PreviewStore {
    manifest: StoreManifest;
    entries: Readonly<Record<string, StoreEntry>>;
    files: StoreFiles;
}

export interface PreviewInput {
    app: string;
    stores: readonly PreviewStore[];
    /** The translator of one language; the page chrome is translated, the listing text is not. */
    t: (language: string) => (msgid: string) => string;
}

const CSS = `:root{color-scheme:light dark;--bg:#f6f5f4;--fg:#1e1e1e;--card:#fff;--line:#d5d2cf;--muted:#5e5c64;--accent:#1c71d8}
@media(prefers-color-scheme:dark){:root{--bg:#1e1e1e;--fg:#f6f5f4;--card:#2b2b2b;--line:#454545;--muted:#b0adb5;--accent:#78aeed}}
*{box-sizing:border-box}body{margin:0;padding:1rem;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:60rem;margin:0 auto}h1,h2,h3{line-height:1.2}
.store{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1rem;margin:1rem 0}
.head{display:flex;gap:1rem;align-items:center;flex-wrap:wrap}.head img{width:64px;height:64px;border-radius:12px}
.summary{color:var(--muted);margin:.25rem 0}.desc{white-space:pre-line}
.tiles,.shots{display:grid;gap:.5rem;grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))}
img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:.25rem .5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}
.badge{font-size:.8em;padding:0 .4em;border-radius:4px;border:1px solid var(--line)}.missing{color:#c01c28;font-weight:600}
a{color:var(--accent)}`;

const image = (store: string, path: string, alt: string) =>
    `<img src="${esc(`${store}/${path}`)}" alt="${esc(alt)}" loading="lazy">`;

function language(store: PreviewStore, lang: string, entry: StoreEntry, t: (msgid: string) => string): string {
    const { manifest, files } = store;
    const id = manifest.store;
    const tiles = [files.promo.small, files.promo.marquee].filter((file): file is string => file !== undefined);
    const rows = manifest.fields
        .map((field) => {
            const status = {
                missing: `<span class="missing">${esc(t('missing'))}</span>`,
                derived: esc(t('ready')),
                manual: esc(t('enter by hand')),
                omitted: esc(t('not set')),
            }[field.status];
            return `<tr><td>${esc(field.label)}${field.required ? ' *' : ''}</td><td>${status}</td></tr>`;
        })
        .join('');
    const permissions = entry.permissions.length
        ? `<h4>${esc(t('Permissions'))}</h4><table>${entry.permissions
              .map(
                  ({ permission, justification }) =>
                      `<tr><td><code>${esc(permission)}</code></td><td>${esc(justification)}</td></tr>`,
              )
              .join('')}</table>`
        : '';
    return `<section lang="${esc(lang)}"><h3>${esc(lang)}</h3>
<div class="head">${files.icon ? image(id, files.icon, '') : ''}<div><strong>${esc(entry.name)}</strong><p class="summary">${esc(entry.summary)}</p></div></div>
${tiles.length ? `<div class="tiles">${tiles.map((file) => image(id, file, t('Promo tile'))).join('')}</div>` : ''}
<p class="desc">${esc(entry.description)}</p>
${files.screenshots.length ? `<div class="shots">${files.screenshots.map((file) => image(id, file, t('Screenshot'))).join('')}</div>` : ''}
${permissions}
<details><summary>${esc(t('Form fields'))}</summary><table>${rows}</table></details></section>`;
}

const heading = (t: (msgid: string) => string) => t('Store listing preview');

/** One self-contained page showing roughly how each store will present the listing; light and dark, usable at 390 px. */
export function storePreviewHtml({ app, stores, t }: PreviewInput): string {
    const first = stores[0] ? Object.keys(stores[0].entries)[0] : undefined;
    const lang = first ?? 'en';
    const body = stores
        .map((store) => {
            const sections = Object.entries(store.entries)
                .map(([code, entry]) => language(store, code, entry, t(code)))
                .join('\n');
            return `<article class="store" id="${esc(store.manifest.store)}"><h2>${esc(store.manifest.label)}</h2>\n${sections}</article>`;
        })
        .join('\n');
    return `<!doctype html>
<html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(app)} — ${esc(heading(t(lang)))}</title><style>${CSS}</style></head>
<body><main><h1>${esc(heading(t(lang)))}</h1>
${body}
</main></body></html>
`;
}

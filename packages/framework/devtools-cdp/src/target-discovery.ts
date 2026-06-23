// target-discovery — enumerate a WebKitGTK process's inspectable targets.
//
// WebKit's remote inspector HTTP server (enabled via the
// `WEBKIT_INSPECTOR_HTTP_SERVER=host:port` env var) does NOT expose Chrome's
// `/json` endpoint. Instead `GET /` returns an HTML page listing each target as
// an anchor: `<a href="/socket/{connectionId}/{targetId}/{type}">title</a>`.
// We parse those anchors into {@link InspectorTarget}s and build the per-target
// WebSocket URL the {@link InspectorProtocolClient} connects to.
//
// The HTML parse is a pure, regex-based function (no DOMParser dependency), so
// it is unit-testable headless against a captured listing; `discoverInspectorTargets`
// adds the `fetch` (injectable) around it.

/** One inspectable target from the WebKit remote-inspector listing. */
export interface InspectorTarget {
    /** The inspector connection id (first `/socket/` path segment). */
    connectionId: string;
    /** The target id (second segment) — stable for the lifetime of the target. */
    targetId: string;
    /** Target kind: `web-page` | `javascript` | `service-worker` | `wasm-debugger` | … */
    targetType: string;
    /** `ws://host:port/socket/{conn}/{target}/{type}` — pass to InspectorProtocolClient. */
    wsUrl: string;
    /** The anchor's visible text (page title / target name), when present. */
    title?: string;
}

export interface DiscoverInspectorTargetsOptions {
    /** Host the inspector HTTP server is bound to. Default `127.0.0.1`. */
    host?: string;
    /** `fetch` implementation (default: global `fetch`). Inject for tests. */
    fetchImpl?: typeof fetch;
}

const DEFAULT_HOST = '127.0.0.1';

// `/socket/{conn}/{target}/{type}` — segments are non-empty, non-slash, non-quote.
const SOCKET_HREF = /\/socket\/([^/"'\s]+)\/([^/"'\s]+)\/([^/"'\s]+)/;
// Whole anchor, to also capture the link text as the title.
const ANCHOR = /<a\b[^>]*\bhref\s*=\s*["']([^"']*\/socket\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

function stripTags(html: string): string {
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Parse the WebKit `GET /` HTML listing into targets. Pure + deterministic —
 * the unit-testable core of {@link discoverInspectorTargets}.
 */
export function parseInspectorTargetsHtml(html: string, host: string, port: number): InspectorTarget[] {
    const targets: InspectorTarget[] = [];
    const seen = new Set<string>();
    for (const match of html.matchAll(ANCHOR)) {
        const href = match[1];
        const seg = SOCKET_HREF.exec(href);
        if (!seg) continue;
        const [, connectionId, targetId, targetType] = seg;
        const key = `${connectionId}/${targetId}/${targetType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const title = stripTags(match[2]);
        targets.push({
            connectionId,
            targetId,
            targetType,
            wsUrl: `ws://${host}:${port}/socket/${connectionId}/${targetId}/${targetType}`,
            title: title || undefined,
        });
    }
    return targets;
}

/**
 * Fetch `http://host:port/` and parse its target listing. Targets only appear
 * once a page has begun loading and there is no `/json` endpoint, so callers
 * that race startup should poll (an empty array is a valid "not ready yet").
 */
export async function discoverInspectorTargets(
    port: number,
    options: DiscoverInspectorTargetsOptions = {},
): Promise<InspectorTarget[]> {
    const host = options.host ?? DEFAULT_HOST;
    const doFetch = options.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!doFetch) {
        throw new Error(
            'discoverInspectorTargets: no global fetch — pass options.fetchImpl (GJS: register @gjsify/fetch)',
        );
    }
    const response = await doFetch(`http://${host}:${port}/`);
    if (!response.ok) {
        throw new Error(`discoverInspectorTargets: GET / returned ${response.status} ${response.statusText}`);
    }
    const html = await response.text();
    return parseInspectorTargetsHtml(html, host, port);
}

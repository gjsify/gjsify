// DOM-query expression builders for @gjsify/iframe — original implementation.
//
// Pure string builders for the JavaScript expressions that IFrameBridge's
// convenience helpers (getLinks / queryDom / clickElement) hand to
// evaluateJavaScript. Kept WebView-free so they unit-test headless. Selectors
// are embedded via JSON.stringify so quotes/backslashes can't break out of the
// generated expression.

/** A link harvested by {@link buildGetLinksExpression}. */
export interface LinkInfo {
    /** Resolved absolute href. */
    href: string;
    /** Trimmed visible text. */
    text: string;
    /** `title` attribute (empty when absent). */
    title: string;
}

/** Element metadata returned by {@link buildQueryDomExpression}. */
export interface ElementInfo {
    tagName: string;
    id: string;
    className: string;
    /** Trimmed text content, capped to keep payloads small. */
    text: string;
    /** `href` attribute when present. */
    href?: string;
    /** True when the element has a non-zero bounding box. */
    visible: boolean;
}

/** Expression: every `<a href>` on the page as {@link LinkInfo}[]. */
export function buildGetLinksExpression(): string {
    return (
        "Array.prototype.slice.call(document.querySelectorAll('a[href]')).map(function(a){" +
        "return {href:a.href,text:(a.textContent||'').trim(),title:a.getAttribute('title')||''};})"
    );
}

/**
 * Expression: `querySelectorAll(selector)` mapped to {@link ElementInfo}[],
 * capped at `limit` to bound the payload.
 */
export function buildQueryDomExpression(selector: string, limit = 200): string {
    const sel = JSON.stringify(selector);
    const cap = Math.max(0, Math.floor(limit));
    return (
        `Array.prototype.slice.call(document.querySelectorAll(${sel})).slice(0,${cap}).map(function(el){` +
        'var r=el.getBoundingClientRect();' +
        'return {tagName:el.tagName,id:el.id||"",' +
        'className:(typeof el.className==="string"?el.className:""),' +
        'text:(el.textContent||"").trim().slice(0,200),' +
        'href:(el.getAttribute&&el.getAttribute("href"))||undefined,' +
        'visible:!!(r.width||r.height)};})'
    );
}

/**
 * Expression (returns boolean): click the first element matching `selectorOrText`
 * — tried first as a CSS selector, then as exact trimmed `<a>` link text. Returns
 * false when nothing matches. An invalid selector is caught and falls through to
 * the text match. The caller awaits navigation separately (register
 * `waitForNavigation()` before invoking, since a fast nav could finish first).
 */
export function buildClickElementExpression(selectorOrText: string): string {
    const target = JSON.stringify(selectorOrText);
    return (
        '(function(){' +
        `var t=${target};var el=null;` +
        'try{el=document.querySelector(t);}catch(_e){el=null;}' +
        'if(!el){var links=Array.prototype.slice.call(document.querySelectorAll("a"));' +
        'for(var i=0;i<links.length;i++){if((links[i].textContent||"").trim()===t){el=links[i];break;}}}' +
        'if(!el)return false;el.click();return true;})()'
    );
}

// `{ pathname, params }` → the URL, and the same table read back out.
//
// THE DEFECT THIS FILE EXISTS FOR DID NOT THROW. `expo-router`'s `router.push`
// accepts `string | { pathname, params }`; this layer accepted the string only, and
// an object handed to it was interpolated — so the push SUCCEEDED, the URL was
// `[object Object]`, no route matched, and every parameterised navigation landed on
// `+not-found`. Measured: 10 call sites in one application, every one of them a
// detail screen reached with a parameter. Nothing reported it, at build time or at
// run time, which makes it worse than the silent no-ops this layer refuses
// everywhere — it navigated somewhere wrong.
//
// TWO DIRECTIONS, ONE DEFINITION, and that is the whole design. `hrefFrom` writes
// params INTO a pattern and `paramsSeenBy` says what `useLocalSearchParams` will hand
// back OUT of it. They are the same rule about what a param is — a scalar becomes a
// string, anything structural is not a URL segment — so a disagreement between them
// is a defect this layer can detect in itself rather than one an application finds.
// `router.spec.ts` drives the round trip; `navigation.ts`' `useLocalSearchParams`
// calls `paramsSeenBy` rather than repeating the filter.
//
// NOTHING HERE IMPORTS REACT NAVIGATION OR REACT. That is what lets the round-trip
// property be asserted with no container mounted and no widget realized.

import { RouterError } from './errors.js';

/** What `router.push` and its siblings accept, as `expo-router` spells it. */
export type Href = string | HrefObject;

export interface HrefObject {
    /** A route pattern — `/detail/[id]` — or a plain path. */
    readonly pathname: string;
    /** Values for the pattern's `[name]` segments; the rest become a query string. */
    readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * React Navigation's own nesting keys, which are not the author's params.
 *
 * `screen`, `params`, `initial`, `state`, `path`, `pop` and `merge` are how a nested
 * NAVIGATE addresses a child navigator. Handing them back as though the author had
 * written them makes those seven param names silently unusable, which is why
 * `useLocalSearchParams` has always filtered them — and why `hrefFrom` refuses to
 * SEND one: a param this layer would not read back is a param that vanishes.
 */
export const INTERNAL_PARAMS: ReadonlySet<string> = new Set([
    'screen',
    'params',
    'initial',
    'state',
    'path',
    'pop',
    'merge',
]);

/**
 * A param value → the string a URL can carry, or `null` for one it cannot.
 *
 * `null` rather than a throw, because the two callers want different things from the
 * same answer: `paramsSeenBy` DROPS what it cannot represent (a route really can
 * arrive carrying a dispatched object, and `useLocalSearchParams` has always left it
 * out), while `hrefFrom` REFUSES it by name (an author writing one meant it to
 * survive the trip).
 */
export const scalar = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
};

/**
 * What `useLocalSearchParams` will hand back for a route carrying `params`.
 *
 * The OUT direction of this file's one rule. Shared with `useLocalSearchParams`
 * itself rather than reimplemented there: two copies of "what counts as a param"
 * would be exactly the mismatch the round-trip test exists to catch, sitting on both
 * sides of it.
 */
export function paramsSeenBy(params: Readonly<Record<string, unknown>> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(params ?? {})) {
        if (INTERNAL_PARAMS.has(key)) continue;
        const text = scalar(value);
        if (text !== null) out[key] = text;
    }
    return out;
}

/** `/detail/[id]` → the param names it carries, in order. */
export function patternParams(pathname: string): readonly string[] {
    const names: string[] = [];
    for (const segment of pathname.split('/')) {
        if (segment.startsWith('[') && segment.endsWith(']')) names.push(segment.slice(1, -1));
    }
    return names;
}

/**
 * An `Href` → the URL string the router resolves.
 *
 * A STRING PASSES THROUGH UNTOUCHED, which is not laziness: expo-router's string
 * form is already a URL, params and all, and re-encoding one would double-escape a
 * query string an author wrote by hand.
 */
export function hrefFrom(call: string, href: Href): string {
    if (typeof href === 'string') return href;
    if (typeof href !== 'object' || href === null) {
        throw new RouterError(
            'unresolved-href',
            `router.${call}()`,
            `takes a path or a { pathname, params } object, and received ${href === null ? 'null' : typeof href}. ` +
                'This used to accept the string form only, and an object reached the router as "[object Object]" — ' +
                'which matched no route and landed on +not-found without a word',
        );
    }
    const { pathname, params } = href;
    if (typeof pathname !== 'string' || pathname === '') {
        throw new RouterError(
            'unresolved-href',
            `router.${call}()`,
            `takes a { pathname } that is a non-empty string, and received ${typeof pathname}`,
        );
    }

    const supplied = new Map<string, unknown>(Object.entries(params ?? {}));
    const segments = pathname.split('/').map((segment) => {
        if (!segment.startsWith('[') || !segment.endsWith(']')) return segment;
        const name = segment.slice(1, -1);
        if (name.startsWith('...')) {
            // The route parser refuses a catch-all when it READS the file tree, for a
            // stated reason (React Navigation's path config has no multi-segment
            // wildcard that also carries its parts as a param). Refusing it here too
            // keeps one answer rather than letting a pathname reach a route that
            // cannot exist.
            throw new RouterError(
                'deep-dynamic-unsupported',
                `router.${call}()`,
                `the pathname "${pathname}" has a catch-all segment "${segment}", and this layer does not answer ` +
                    'for catch-all routes — the file-tree parser refuses one too. Use one [param] per segment',
            );
        }
        if (!supplied.has(name)) {
            throw new RouterError(
                'unresolved-href',
                `router.${call}()`,
                `the pathname "${pathname}" needs a param "${name}" and params carries ${
                    supplied.size === 0 ? 'none' : Object.keys(params ?? {}).join(', ')
                }. Leaving it unfilled would send the literal "${segment}" to the router, which matches no route`,
            );
        }
        const value = supplied.get(name);
        supplied.delete(name);
        const text = scalar(value);
        if (text === null) {
            throw new RouterError(
                'unresolved-href',
                `router.${call}()`,
                `the param "${name}" is ${Array.isArray(value) ? 'an array' : typeof value}, and a URL segment is ` +
                    'a string. useLocalSearchParams() reads segments back as strings, so a structural value could ' +
                    'not survive the trip in either direction',
            );
        }
        return encodeURIComponent(text);
    });

    // WHAT IS LEFT OVER BECOMES A QUERY STRING, which is expo-router's own behaviour
    // and also what makes the round trip total: `useLocalSearchParams` answers for
    // the query half as well as the segments, so a param that did not fit the pattern
    // still comes back.
    const query = new URLSearchParams();
    for (const [key, value] of supplied) {
        if (INTERNAL_PARAMS.has(key)) {
            throw new RouterError(
                'unresolved-href',
                `router.${call}()`,
                `"${key}" is one of React Navigation's own nesting keys (${[...INTERNAL_PARAMS].join(', ')}), so ` +
                    'useLocalSearchParams() filters it out — sending it would be a param that silently never arrives',
            );
        }
        const text = scalar(value);
        if (text === null) {
            throw new RouterError(
                'unresolved-href',
                `router.${call}()`,
                `the param "${key}" is ${Array.isArray(value) ? 'an array' : typeof value}, and a query value is ` +
                    'a string. Serialise it, or put it in a store rather than in the URL',
            );
        }
        query.append(key, text);
    }
    const search = query.toString();
    return search === '' ? segments.join('/') : `${segments.join('/')}?${search}`;
}

/**
 * The inverse: the params a URL built from `pathname` carries.
 *
 * Pure, and it exists for the round-trip property rather than for the runtime — the
 * real read-back goes through React Navigation's own state. What this gives is a
 * check the layer can run on ITSELF: whatever `hrefFrom` writes into a pattern, this
 * reads out, and the two must agree with `paramsSeenBy`. A drift between the writer
 * and the reader is the defect that produced this file, so it is the one thing here
 * that is asserted rather than argued.
 */
export function paramsInHref(pathname: string, url: string): Record<string, string> {
    const [path, search = ''] = url.split('?');
    const patternSegments = pathname.split('/');
    const urlSegments = (path ?? '').split('/');
    const out: Record<string, string> = {};
    for (const [index, segment] of patternSegments.entries()) {
        if (!segment.startsWith('[') || !segment.endsWith(']')) continue;
        const value = urlSegments[index];
        if (value === undefined) continue;
        out[segment.slice(1, -1)] = decodeURIComponent(value);
    }
    for (const [key, value] of new URLSearchParams(search)) out[key] = value;
    return out;
}

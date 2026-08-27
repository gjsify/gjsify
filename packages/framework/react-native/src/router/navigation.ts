// `router`, `usePathname`, `useLocalSearchParams` — three of the five names, and
// almost none of the code that makes them work.
//
// WHAT IS REUSED. Every URL question is answered by `@react-navigation/core`:
// `getStateFromPath` turns an href into navigation state, `getActionFromState`
// turns that state into an action a container can dispatch, `getPathFromState`
// turns the live state back into an href. ADR 0032 § 10 chose that reuse over a
// second router, and this module is where the choice pays — a URL matcher with
// nested navigators, params and a wildcard fallback is the part of a router with
// the most edge cases and the least novelty.
//
// WHAT IS WRITTEN. Three things React Navigation deliberately does not have,
// because they are `expo-router`'s idea rather than its own:
//
//   1. `push` versus `navigate`. React Navigation's NAVIGATE reuses a screen that is
//      already the current one; expo-router's `push` always adds an entry. The
//      difference is a TARGETED `StackActions.push`, and `targetFor` is how the
//      target is found — the one thing upstream cannot do for us, because an href
//      names a screen that may live several navigators down and `StackActions` are
//      dispatched at exactly one navigator.
//   2. `back()` refusing when there is nowhere to go. React Navigation's own
//      `goBack` returns quietly, which here would be the silent drop this layer
//      refuses everywhere else: a back button that does nothing, with no message.
//   3. A module-level runtime, so `router.push(…)` works from an event handler with
//      no hook and no component in scope. That is the shape of the name being
//      copied: ADR 0032 measured 19 of the router uses as exactly that.
//
// WHY A MODULE-LEVEL SINGLETON IS ACCEPTABLE HERE, stated because usually it is
// not. `router` is an OBJECT in the surface being reproduced, not a hook — there is
// no component for a context to reach it from. One process renders one application
// (`AppRegistry` CREATES the application), and mounting a second `RouterRoot` is
// refused by name rather than silently rebinding the singleton to whichever mounted
// last, because that failure presents as "the button does nothing".

import {
    CommonActions,
    StackActions,
    createNavigationContainerRef,
    getActionFromState,
    getPathFromState,
    getStateFromPath,
    useRoute,
} from '@react-navigation/core';
import type { NavigationState, PartialState } from '@react-navigation/core';
import { useSyncExternalStore } from 'react';

import { RouterError } from './errors.js';
import { pathConfigOf, screenUrls, type PathConfigTree, type RouteNode } from './routes.js';

/** The container ref every navigator in the tree hangs under. */
export const navigationRef = createNavigationContainerRef();

/** What `getStateFromPath` answers with — a state with only the parts a URL names. */
type ResolvedState = PartialState<NavigationState>;

/**
 * The config, in the shape upstream's functions accept.
 *
 * `PathConfigMap<ParamList>` describes a config written against a KNOWN param list:
 * its nested `screens` type-check only where that list declares
 * `NavigatorScreenParams`. A tree derived from FILES has no such declaration at
 * compile time — the files are the declaration — so the shape is ours and this is
 * the seam. What a cast removes, `routes.spec.ts` puts back behaviourally: it
 * round-trips a nested tree through `getStateFromPath` and `getPathFromState` and
 * asserts the URLs, which is the only check that can fail if upstream's accepted
 * shape ever changes.
 */
type UpstreamConfig = Parameters<typeof getStateFromPath>[1];
const upstream = (config: PathConfigTree): UpstreamConfig => config as unknown as UpstreamConfig;

interface Runtime {
    readonly tree: RouteNode;
    readonly config: PathConfigTree;
}

let runtime: Runtime | null = null;

/**
 * Subscribers to "the navigation state changed", and NOT a copy of that state.
 *
 * MEASURED ORDERING, and the reason there is no copy: `navigation.dispatch` updates
 * the container's own state EAGERLY — `getRootState()` reports the popped stack before
 * React has re-rendered — while `BaseNavigationContainer` reports the change through
 * `onStateChange`, which runs from an effect. A copy fed from that callback therefore
 * trails the container, and a hook reading the copy answers a URL the tree has already
 * left. So the state is read LIVE off the container ref and these listeners carry only
 * the notification: one source of truth, and no window in which two disagree.
 */
const listeners = new Set<() => void>();

/** The container's own state, or `undefined` before it is ready. */
const liveRootState = (): NavigationState | undefined =>
    navigationRef.isReady() ? (navigationRef.getRootState() as NavigationState | undefined) : undefined;

/**
 * Bind the module-level `router` to a mounted tree. Called by `RouterRoot`.
 *
 * Refuses a second binding by name. The alternative — the newest `RouterRoot` wins —
 * makes `router.push` navigate a tree the user is not looking at.
 */
export function installRouter(tree: RouteNode): void {
    if (runtime !== null) {
        throw new RouterError(
            'no-router-mounted',
            'RouterRoot',
            'is already mounted. `router` is a module-level object — the shape of the name being reproduced — so ' +
                'one process routes one tree. Render one RouterRoot and nest navigators inside it',
        );
    }
    runtime = { tree, config: pathConfigOf(tree) };
}

/** Release the binding. Called when `RouterRoot` unmounts. */
export function uninstallRouter(): void {
    runtime = null;
    notifyStateChanged();
}

/**
 * Tell every subscriber the navigation state moved.
 *
 * Called from the container's `onReady` and `onStateChange`. It carries no state,
 * because the state is read live — see `listeners` for the measurement behind that.
 */
export function notifyStateChanged(): void {
    for (const listener of listeners) listener();
}

/** The mounted runtime, or a refusal naming what to do about it. */
function required(call: string): Runtime {
    if (runtime === null) {
        throw new RouterError(
            'no-router-mounted',
            `router.${call}()`,
            'was called with no router mounted. Render <RouterRoot manifest={…}> above the tree that calls it — ' +
                'the manifest is the bundler plugin’s virtual module',
        );
    }
    return runtime;
}

/** The container, once it is ready. Separate from `required`: the ref is set later. */
function readyContainer(call: string): typeof navigationRef {
    required(call);
    if (!navigationRef.isReady()) {
        throw new RouterError(
            'no-router-mounted',
            `router.${call}()`,
            'was called before the navigation container was ready. A container becomes ready during the first ' +
                'commit, so this is a call from a module body or from a render — move it into an effect or an ' +
                'event handler',
        );
    }
    return navigationRef;
}

/** An href → the navigation state it names, or a refusal listing what would match. */
function resolve(call: string, href: string): ResolvedState {
    const { tree, config } = required(call);
    const state = getStateFromPath(href, upstream(config));
    if (state === undefined) {
        throw new RouterError(
            'unresolved-href',
            href,
            `matches no route. The manifest holds: ${screenUrls(tree).join(', ')}. A \`+not-found.tsx\` catches ` +
                'everything else',
        );
    }
    return state;
}

/** The route the state focuses at each depth, outermost first. */
function focusChain(state: ResolvedState): readonly { readonly name: string; readonly params?: object }[] {
    const chain: { name: string; params?: object }[] = [];
    let current: ResolvedState | undefined = state;
    while (current !== undefined) {
        const index = current.index ?? current.routes.length - 1;
        const route = current.routes[index];
        if (route === undefined) break;
        chain.push({ name: route.name, ...(route.params === undefined ? {} : { params: route.params }) });
        current = route.state as ResolvedState | undefined;
    }
    return chain;
}

/**
 * The LIVE navigator that owns the leaf of `chain`, if it is on screen.
 *
 * `null` means the navigator is not mounted yet — and that answer is as useful as a
 * key: arriving at an unmounted navigator IS a new entry, so a plain NAVIGATE does
 * what `push` asked for and no target is needed.
 */
function targetFor(
    chain: readonly { readonly name: string }[],
): { readonly key: string; readonly type: string } | null {
    let state: NavigationState | undefined = liveRootState();
    for (const [depth, step] of chain.entries()) {
        if (state === undefined) return null;
        if (depth === chain.length - 1) {
            return state.routeNames.includes(step.name) ? { key: state.key, type: state.type } : null;
        }
        const route = state.routes.find((candidate) => candidate.name === step.name);
        if (route === undefined) return null;
        state = route.state as NavigationState | undefined;
    }
    return null;
}

/** `push` and `replace` differ in one action name and nothing else. */
function pushOrReplace(call: 'push' | 'replace', href: string): void {
    const container = readyContainer(call);
    const { config } = required(call);
    const state = resolve(call, href);
    const chain = focusChain(state);
    const leaf = chain[chain.length - 1];
    const target = targetFor(chain);
    if (leaf !== undefined && target !== null && target.type === 'stack') {
        const action =
            call === 'push' ? StackActions.push(leaf.name, leaf.params) : StackActions.replace(leaf.name, leaf.params);
        container.dispatch({ ...action, target: target.key });
        return;
    }
    // The owning navigator is not mounted, or is not a stack — PUSH and REPLACE are
    // the stack router's actions and no other router answers them. NAVIGATE is what
    // is left, and for an unmounted navigator it is also right: reaching it adds the
    // entry. Declared as a limit on `router.push` in the support table rather than
    // left for someone to find in a window.
    const action = getActionFromState(state, upstream(config));
    container.dispatch(action ?? CommonActions.reset(state));
}

/**
 * `expo-router`'s `router`: four methods, and every argument a URL.
 *
 * ADR 0032 measured the calls — `push` 19 times, `back` and `replace` a handful
 * each, `navigate` where a screen must not stack up. That is the whole object.
 */
export const router = {
    /** Go to `href`, adding a history entry even when that screen is already showing. */
    push(href: string): void {
        pushOrReplace('push', href);
    },

    /** Go to `href`, reusing the screen when it is already the current one. */
    navigate(href: string): void {
        const container = readyContainer('navigate');
        const { config } = required('navigate');
        const state = resolve('navigate', href);
        const action = getActionFromState(state, upstream(config));
        container.dispatch(action ?? CommonActions.reset(state));
    },

    /** Replace the current screen with `href`, leaving the history length alone. */
    replace(href: string): void {
        pushOrReplace('replace', href);
    },

    /**
     * Go back one entry.
     *
     * REFUSES when there is nowhere to go, which React Navigation's own `goBack`
     * does not — it returns quietly. A quiet return is the silent drop this layer
     * refuses everywhere else: the user presses back, the window does not change,
     * and nothing anywhere says why.
     */
    back(): void {
        const container = readyContainer('back');
        if (!container.canGoBack()) {
            throw new RouterError(
                'unresolved-href',
                'router.back()',
                'has nothing to go back to — this is the first screen in the history. Guard the call, or use ' +
                    'router.replace() to leave a screen that cannot be popped',
            );
        }
        container.dispatch(CommonActions.goBack());
    },
} as const;

// ---------------------------------------------------------------------------
// The two hooks
// ---------------------------------------------------------------------------

// A module-level subscriber, so its identity is stable: `useSyncExternalStore`
// re-subscribes whenever this function changes, and an inline arrow would tear the
// subscription down and build it back up on every render. Same rule, same reason as
// `hooks.ts`' colour-scheme subscriber.
const subscribe = (onStoreChange: () => void): (() => void) => {
    listeners.add(onStoreChange);
    return () => {
        listeners.delete(onStoreChange);
    };
};

/** React Navigation's own nesting keys, which are not the author's params. */
const INTERNAL_PARAMS: ReadonlySet<string> = new Set(['screen', 'params', 'initial', 'state', 'path', 'pop', 'merge']);

const currentPathname = (): string => {
    const state = liveRootState();
    if (runtime === null || state === undefined) return '/';
    const path = getPathFromState(state, upstream(runtime.config));
    // `getPathFromState` appends every param the pattern does not carry as a query
    // string. `usePathname` is the PATH — expo-router splits the two the same way,
    // and the query half is what `useLocalSearchParams` answers for.
    const query = path.indexOf('?');
    return query === -1 ? path : path.slice(0, query);
};

/**
 * The current URL, without its query string.
 *
 * `useSyncExternalStore` and not `useNavigationState`, for two reasons that both
 * matter: the value is derived from the ROOT state while a hook inside a screen sees
 * only its own navigator's, and the store can change between render and commit —
 * the tear `useSyncExternalStore` exists to prevent. The snapshot is a STRING, which
 * is what makes reading it live from the container legal: React compares snapshots by
 * identity, and a fresh object every call is the "getSnapshot should be cached"
 * warning.
 *
 * The `/` it answers before the container is ready is not a placeholder: nothing has
 * been navigated to yet, and the root URL is what the tree is about to show.
 */
export function usePathname(): string {
    return useSyncExternalStore(subscribe, currentPathname, currentPathname);
}

/**
 * The params of the CURRENT route — the `[param]` values and the query string.
 *
 * `Local`, in expo-router's own sense: the params of the screen that calls it, not
 * of whichever screen is focused elsewhere in the tree. That is `useRoute()`, which
 * reads the nearest route context, minus React Navigation's own nesting keys —
 * `screen`, `params`, `initial`, `state`, `path`, `pop` and `merge` are how a nested
 * NAVIGATE addresses a child navigator, and handing them back as though the author
 * had written them makes those seven param names silently unusable.
 *
 * Values are strings, because a URL segment is one. A number or a boolean that
 * arrived through a dispatched param is stringified rather than dropped; anything
 * structural (an object, an array) is left out, and `[param]` cannot produce one.
 */
export function useLocalSearchParams<T extends Record<string, string> = Record<string, string>>(): Partial<T> {
    const route = useRoute();
    const params = (route.params ?? {}) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
        if (INTERNAL_PARAMS.has(key)) continue;
        if (typeof value === 'string') out[key] = value;
        else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
    }
    return out as Partial<T>;
}

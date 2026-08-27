// What `<Stack>` and `<Tabs>` share: where their screens come from, and what a
// `<X.Screen>` child is for.
//
// THE ONE IDEA THIS FILE HOLDS. In React Navigation a navigator's screens are its
// CHILDREN; in `expo-router` they are the FILES in the directory the `_layout` owns,
// and `<Stack.Screen name="index" options={…}/>` only configures one. Both are true
// here at once: `RouterRoot` publishes the layout's own `RouteNode` through a
// context, a navigator reads its children off that node, and it synthesises the
// React Navigation `<Screen>` elements `useNavigationBuilder` wants. The declared
// `<X.Screen>` children are read as DATA and never rendered.
//
// So a navigator's body is: read the node, collect the options, map the node's
// children to screens. That is the same three lines for a stack and for tabs, which
// is why they live here and not twice.
//
// WHY `createElement` AND NOT A JSX RUNTIME — the rule `components.ts` states and
// this file follows for the same two reasons: a JSX runtime import would decide the
// consumer's `jsxImportSource` for them, and a hand-built element literal's
// `$$typeof` is React-version-specific (`react.element` became
// `react.transitional.element` in 19).

import { createNavigatorFactory } from '@react-navigation/core';
import {
    Children,
    createContext,
    createElement,
    isValidElement,
    useContext,
    useMemo,
    type ComponentType,
    type ReactElement,
    type ReactNode,
} from 'react';

import { RouterError } from './errors.js';
import type { RouteNode } from './routes.js';

/**
 * The layout node the navigator being rendered belongs to.
 *
 * A context, because the carrier is a framework concern and the node is not — the
 * same split `components.ts` records for `ParentContext`. `RouterRoot` publishes the
 * root node; a nested layout's screen wrapper publishes its own before rendering the
 * layout's component, which is what makes `<Tabs>` inside `(tabs)/_layout.tsx` find
 * the four files in `(tabs)/` and nothing else.
 */
const RouteNodeContext = createContext<RouteNode | null>(null);

/** Publish `node` to the navigator a layout component is about to render. */
export const provideRouteNode = (node: RouteNode, children: ReactNode): ReactElement =>
    createElement(RouteNodeContext.Provider, { value: node }, children);

/** The layout node this navigator belongs to, or a refusal naming the fix. */
export function useRouteNode(navigator: string): RouteNode {
    const node = useContext(RouteNodeContext);
    if (node === null) {
        throw new RouterError(
            'no-route-node',
            `<${navigator}>`,
            'was rendered outside the router, so it has no directory to take its screens from. A navigator ' +
                'belongs in a `_layout` file under the routes directory, and the tree needs a <RouterRoot ' +
                'manifest={…}> above it',
        );
    }
    return node;
}

// ---------------------------------------------------------------------------
// A route module → a component
// ---------------------------------------------------------------------------

/**
 * A route file's default export, checked.
 *
 * The check is worth its lines because the failure it replaces is silent: React
 * renders `undefined` as nothing, so a route file that exports `Screen` instead of
 * `default Screen` shows an EMPTY page and no message, and the author reads it as a
 * styling problem.
 *
 * A FUNCTION OR AN OBJECT, because both are components: `memo`, `forwardRef` and
 * `lazy` all produce objects carrying a `$$typeof`. Narrowing to `typeof ===
 * "function"` would refuse a memoised route file, which is an ordinary thing to
 * write. The remaining error — an object that is not a component — is React's to
 * report, and it does so by name.
 */
function defaultExportOf(node: RouteNode): ComponentType<Record<string, unknown>> {
    const module = node.module;
    if (module === null || typeof module !== 'object') {
        throw new RouterError(
            'bad-route-module',
            node.contextKey ?? node.name,
            'has no module. Every manifest entry needs the evaluated module of its route file — a plugin emits ' +
                '`import * as R from "./route"` and passes `R`',
        );
    }
    const exported = (module as { default?: unknown }).default;
    if (typeof exported !== 'function' && (typeof exported !== 'object' || exported === null)) {
        const names = Object.keys(module).filter((key) => key !== '__esModule');
        throw new RouterError(
            'bad-route-module',
            node.contextKey ?? node.name,
            `exports no default component. A route file default-exports the component for its screen; this one ` +
                `exports ${names.length === 0 ? 'nothing' : names.join(', ')}. Without the check React would ` +
                'render `undefined` as an empty page and say nothing',
        );
    }
    return exported as ComponentType<Record<string, unknown>>;
}

/**
 * The component React Navigation should render for `node`, with a STABLE identity.
 *
 * Stable matters: React Navigation keys a screen's mounted subtree by its component,
 * and a fresh wrapper per render would unmount and remount every screen on every
 * commit. The cache is keyed by the node, whose identity is per-manifest and
 * therefore per-application-lifetime.
 *
 * A LAYOUT node's component is wrapped, a SCREEN node's is not, and that is the
 * whole nesting mechanism: the wrapper publishes the layout's own node before
 * rendering it, so the `<Stack>` or `<Tabs>` inside sees its own directory.
 */
const components = new WeakMap<RouteNode, ComponentType<Record<string, unknown>>>();

export function componentFor(node: RouteNode): ComponentType<Record<string, unknown>> {
    const cached = components.get(node);
    if (cached !== undefined) return cached;
    const Exported = defaultExportOf(node);
    const component: ComponentType<Record<string, unknown>> =
        node.kind === 'screen'
            ? Exported
            : (props: Record<string, unknown>) => provideRouteNode(node, createElement(Exported, props));
    // A name, because React Navigation prints it in its own warnings and a stack of
    // anonymous wrappers is unreadable.
    (component as { displayName?: string }).displayName = `Route(${node.contextKey ?? node.name})`;
    components.set(node, component);
    return component;
}

// ---------------------------------------------------------------------------
// `<X.Screen>` children → options
// ---------------------------------------------------------------------------

/** What a `<Stack.Screen>` / `<Tabs.Screen>` declaration carries. */
export interface ScreenDeclaration {
    /** The route name — the file's path relative to this navigator, e.g. `index`. */
    name: string;
    /** Per-screen options. Validated against the navigator's own allow-list. */
    options?: Record<string, unknown>;
}

/**
 * A navigator's declared children → options by route name.
 *
 * REFUSES ANY OTHER CHILD BY NAME. `<Stack>{loading ? <Spinner/> : null}</Stack>` is
 * the shape that gets written, and expo-router ignores it — which means a widget the
 * author put in a navigator vanishes with no message. The refusal names the child
 * and says where content belongs, which is inside a route file.
 *
 * `allowed` is the navigator's own option vocabulary, and an option outside it is
 * refused for the same reason: `headerTintColor` silently doing nothing is a defect
 * that only a screenshot can find.
 */
export function screenOptionsFrom(
    navigator: string,
    ScreenMarker: ComponentType<ScreenDeclaration>,
    allowed: readonly string[],
    children: ReactNode,
): ReadonlyMap<string, Record<string, unknown>> {
    const out = new Map<string, Record<string, unknown>>();
    for (const child of Children.toArray(children)) {
        if (!isValidElement(child) || child.type !== ScreenMarker) {
            const what = isValidElement(child)
                ? `a <${typeof child.type === 'string' ? child.type : ((child.type as { displayName?: string; name?: string }).displayName ?? (child.type as { name?: string }).name ?? 'component')}>`
                : `${typeof child} ${JSON.stringify(child)}`;
            throw new RouterError(
                'not-a-screen-child',
                `<${navigator}>`,
                `was given ${what} as a child. A navigator's children are its screens, and its screens come from ` +
                    `the files in the directory its \`_layout\` owns — the only child it reads is ` +
                    `<${navigator}.Screen name="…" options={…}/>, which configures one of them. Put content in a ` +
                    'route file',
            );
        }
        const declaration = child.props as ScreenDeclaration;
        if (typeof declaration.name !== 'string' || declaration.name === '') {
            throw new RouterError(
                'not-a-screen-child',
                `<${navigator}.Screen>`,
                "needs a `name` — the route file's path relative to this navigator, without its extension: " +
                    '`index`, `settings`, `detail/[id]`',
            );
        }
        const options = declaration.options ?? {};
        for (const key of Object.keys(options)) {
            if (allowed.includes(key)) continue;
            throw new RouterError(
                'unknown-screen-option',
                `<${navigator}.Screen name="${declaration.name}">`,
                `sets "${key}", which this navigator has no GTK answer for. It answers ${allowed.join(', ')}. ` +
                    'An option that is accepted and ignored is invisible until someone looks at the window',
            );
        }
        out.set(declaration.name, options);
    }
    return out;
}

/**
 * The React Navigation `<Screen>` elements a navigator's node implies.
 *
 * Memoised on the node and the options, because `useNavigationBuilder` reads these
 * children on every render and rebuilding the elements is cheap while rebuilding the
 * COMPONENTS is not — `componentFor` is what holds that line, and this hook keeps
 * the element array from churning as well.
 */
export function useSynthesisedScreens(
    node: RouteNode,
    Screen: ComponentType<ScreenDeclaration>,
    options: ReadonlyMap<string, Record<string, unknown>>,
): readonly ReactElement[] {
    const signature = node.children
        .map((child) => `${child.name}:${JSON.stringify(options.get(child.name) ?? {})}`)
        .join('|');
    return useMemo(
        () =>
            node.children.map((child) =>
                createElement(Screen, {
                    key: child.name,
                    name: child.name,
                    component: componentFor(child),
                    options: options.get(child.name) ?? {},
                } as ScreenDeclaration & { key: string; component: ComponentType<Record<string, unknown>> }),
            ),
        // `signature` and the node, deliberately: `options` is a fresh Map on every
        // render by construction, so including it would defeat the memo entirely —
        // the same trap `components.ts`' `useSignals` records for its `events` array.
        [node, Screen, signature],
    );
}

/**
 * Core's own `Screen`, which is the only component `useNavigationBuilder` accepts.
 *
 * Reached through the public factory rather than imported: `@react-navigation/core`
 * does not export `Screen` from its index (it is meant to arrive with a `Navigator`),
 * and calling the factory with a component nothing renders is the documented way to
 * get the pair. The typed shape is asserted here once so no navigator repeats it.
 */
export function navigationPair<Props>(View: ComponentType<Props>): {
    readonly Navigator: ComponentType<Props>;
    readonly Screen: ComponentType<ScreenDeclaration>;
} {
    // `ComponentType<any>` is what upstream's parameter is, and `ComponentType<never>`
    // is NOT assignable to it: a class component's `getDerivedStateFromProps` makes
    // props contravariant, so `never` props reject `any` props. `Record<string,
    // unknown>` is the widest shape that stays honest here — the factory only reads
    // the component's `displayName`.
    return createNavigatorFactory(View as unknown as ComponentType<Record<string, unknown>>)() as {
        readonly Navigator: ComponentType<Props>;
        readonly Screen: ComponentType<ScreenDeclaration>;
    };
}

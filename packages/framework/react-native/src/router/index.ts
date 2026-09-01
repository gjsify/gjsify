// `@gjsify/react-native/router` — the `expo-router` surface, over React Navigation.
//
// The subpath a consumer's bundler aliases `expo-router` to, the same way `.` is what
// it aliases `react-native` to. Its export surface therefore mirrors expo-router's
// name for name: what is implemented is exported normally, and what is not is
// exported as a value that refuses with `ROUTER_SUPPORT_TABLE`'s own sentence, so a
// reader gets a reason rather than a `MISSING_EXPORT`.
//
// FIVE NAMES ARE REAL, and they are the five ADR 0032 measured in an application:
// `router`, `useLocalSearchParams`, `usePathname`, `Tabs`, `Stack`. Everything else
// in the table is planned or refused — full expo-router compatibility is rejected by
// § 10 because it drags `react-native-screens` and `gesture-handler`, which nothing
// here imports. Reproducing a dependency cloud nobody calls is not compatibility.
//
// WHAT IS REUSED, in one sentence, because it is the decision: React Navigation 7's
// `core` and `routers` run UNMODIFIED and answer every state and URL question —
// routers, actions, contexts, `getStateFromPath`, `getPathFromState`,
// `getActionFromState`, `useNavigationBuilder`, `usePreventRemove`. What this package
// adds is the file convention, two widget bindings, and the three things upstream
// cannot know: which GTK operation a stack diff is, what the widget's own `popped`
// means, and how long a closing page has to stay mounted.

export { hrefFrom, paramsInHref, paramsSeenBy, patternParams } from './href.js';
export type { Href, HrefObject } from './href.js';

export { router, usePathname, useLocalSearchParams, navigationRef } from './navigation.js';
export { Stack, type StackProps, type StackScreenOptions } from './stack.js';
export { Tabs, type TabsProps, type TabScreenOptions } from './tabs.js';
export { RouterRoot, type RouterRootProps } from './root.js';
export { RouterError, type RouterErrorCode } from './errors.js';

// The convention layer is public: it is a pure function from a file list to a tree,
// and a consumer building their own tooling — a route dump, a link checker, a
// codegen — should read the same data the router reads rather than re-implement the
// four rules. It is also how a consumer on a bundler this repository does not ship a
// plugin for gets the refusals (ADR 0032 § 12).
export {
    buildRouteTree,
    pathConfigOf,
    screenUrls,
    type PathConfigLeaf,
    type PathConfigNode,
    type PathConfigTree,
    type RouteManifest,
    type RouteManifestEntry,
    type RouteNode,
} from './routes.js';

// L3's seam for a layout that is not one of the two navigators: the node a `_layout`
// owns, and the screen synthesis over it. Exported for the same reason `primitives`
// is exported from the main entry — it is what makes "the navigators are adapters
// over shared data" checkable from outside rather than a claim.
export {
    componentFor,
    provideRouteNode,
    screenOptionsFrom,
    useRouteNode,
    useSynthesisedScreens,
    type ScreenDeclaration,
} from './screens.js';

// Everything the routing surface does not answer for yet. Generated from
// `ROUTER_SUPPORT_TABLE` (`scripts/generate-exports.mjs`), because a bundler needs
// static export names to resolve an import at all and a loop cannot produce them.
export * from '../generated/unsupported-router.js';

// The table itself, for the same reason the React Native one is public: a consumer's
// own lint rule or dashboard should read the data, not scrape the README generated
// from it.
export { ROUTER_NAMES, ROUTER_SUPPORT_TABLE, explainUnsupported, isImportable } from '../support-table.js';
export type { SupportEntry, SupportStatus, SupportTier } from '../support-table.js';

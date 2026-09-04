// The one error the router throws, and the codes it throws it with.
//
// Same shape and the same reason as `primitives/errors.ts` one layer over: a named
// class so a consumer can tell "the router does not answer for that" from a bug in
// their own code, and a message that names WHAT arrived, WHY it cannot work, and
// WHAT to write instead.
//
// A SEPARATE class from `PrimitiveError`, not a re-export. The two answer different
// questions and a caller catching one must not silently catch the other: a
// `<Text numberOfLines>` refusal is about a widget mapping, a `[].tsx` refusal is
// about a file name. Nothing that catches "my styling vocabulary is wrong" should
// also swallow "two of your files claim the same URL".
//
// WHY THERE IS A `code` AS WELL AS A MESSAGE. The messages are long on purpose —
// they are what a developer reads at 2 a.m. — and a spec asserting a long sentence
// pins its prose rather than its behaviour. The code is the stable half: vectors
// assert the code, readers get the sentence, and rewording a diagnostic does not
// turn a test red for no reason.

/** What went wrong, as a stable identifier. */
export type RouterErrorCode =
    /** A file under the routes directory matches none of the four conventions. */
    | 'unknown-convention'
    /** A `[…]` segment with nothing between the brackets. */
    | 'param-without-name'
    /** Two route files resolve to the same URL. */
    | 'duplicate-route'
    /** `[...rest]` — a catch-all segment, which this layer does not answer yet. */
    | 'deep-dynamic-unsupported'
    /** `(a,b)` — expo-router's shared groups, which this layer does not answer. */
    | 'shared-group-unsupported'
    /** A `_layout` file whose directory holds no routes. */
    | 'layout-without-routes'
    /** The route manifest is empty, or not the shape the plugin emits. */
    | 'bad-manifest'
    /** A route module with no default export, or one that is not a component. */
    | 'bad-route-module'
    /** `router.*` was called with no router mounted. */
    | 'no-router-mounted'
    /** An href no route in the manifest matches. */
    | 'unresolved-href'
    /** A child of `<Stack>` / `<Tabs>` that is not its own `.Screen`. */
    | 'not-a-screen-child'
    /** An `options` key the navigator has no GTK answer for. */
    | 'unknown-screen-option'
    /** A navigator rendered outside the router, so it has no route node to build from. */
    | 'no-route-node'
    /** Two navigators inside one screen both contributing to its header bar's title. */
    | 'chrome-taken';

/** A routing input, file name or call this layer cannot answer for, and why. */
export class RouterError extends Error {
    override readonly name = 'RouterError';
    /** The stable identifier. Assert this in a test; print the message to a human. */
    readonly code: RouterErrorCode;
    /** The file, href or prop the refusal is about. */
    readonly subject: string;

    constructor(code: RouterErrorCode, subject: string, detail: string) {
        super(`@gjsify/react-native/router: ${subject === '' ? '' : `${subject} — `}${detail} [${code}]`);
        this.code = code;
        this.subject = subject;
    }
}

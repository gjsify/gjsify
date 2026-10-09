// The `ViewBase` contract of upstream `@nativescript/core` (`ui/core/view-base/index.d.ts`, 9.x),
// narrowed to the members a leaf view overrides. The real package is an optional peer kept out of
// the workspace install, so `check:consumer` pins the signatures a consumer's real types impose
// (`object` stands for upstream's `Object`; `unknown` fails both, which is what the guard needs).
// `src/ns-core.d.ts` is the ambient slice the package compiles against and is not emitted.
declare module '@nativescript/core' {
    export class Observable {
        notify<T extends { eventName: string; object: Observable }>(data: T): void;
    }

    export abstract class ViewBase extends Observable {
        className: string;
        _context: unknown;
        nativeViewProtected: unknown;
        createNativeView(): object;
        initNativeView(): void;
        disposeNativeView(): void;
        onLoaded(): void;
        onUnloaded(): void;
    }

    export class View extends ViewBase {}
}

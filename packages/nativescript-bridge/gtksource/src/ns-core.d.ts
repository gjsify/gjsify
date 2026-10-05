// Ambient minimal type surface for `@nativescript/core` — the slice this package touches.
//
// `@nativescript/core` is an OPTIONAL peer, absent from the workspace install, so this
// declaration keeps `gjsify tsc` green off-device (see `@gjsify/adwaita-nativescript`'s file of
// the same name for the full reasoning; a consumer's real types win when installed).

declare module '@nativescript/core' {
    export interface EventData {
        eventName: string;
        object: Observable;
    }

    export class Observable {
        notify<T extends EventData>(data: T): void;
    }

    /** `ViewBase` members a custom leaf view overrides, per `ui/core/view-base`. */
    export class View extends Observable {
        className: string;
        /** The Android `Context`; defined once the view is attached to an activity. */
        _context: unknown;
        /** The platform view `createNativeView()` returned; `undefined` before attach and after dispose. */
        nativeViewProtected: unknown;
        createNativeView(): unknown;
        initNativeView(): void;
        disposeNativeView(): void;
        onLoaded(): void;
        onUnloaded(): void;
    }

    export class LayoutBase extends View {
        addChild(view: View): void;
    }

    export class ItemSpec {
        constructor(value?: number, type?: 'auto' | 'pixel' | 'star');
    }

    export class GridLayout extends LayoutBase {
        addColumn(itemSpec: ItemSpec): void;
        addRow(itemSpec: ItemSpec): void;
    }
}

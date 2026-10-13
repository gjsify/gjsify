// What upstream `@nativescript/core` 9.x declares on the members our widgets re-declare with another
// type, merged onto the ambient slice `adwaita-nativescript/src/ns-core.d.ts` (listed in the tsconfig `files`) (the real package is an
// optional peer and its own `.d.ts` fail under TS 6, so it is never loaded here). The shapes are
// copied from `ui/core/view/view-common.d.ts` and `ui/layouts/grid-layout/grid-layout-common.d.ts`.
declare module '@nativescript/core' {
    interface View {
        readonly modal: View;
        direction: 'ltr' | 'rtl';
    }
    interface GridLayout {
        rows: string;
        columns: string;
    }
}

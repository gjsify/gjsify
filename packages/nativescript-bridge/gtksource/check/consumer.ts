// What a NativeScript app does with the published types and the `ViewBase` contract of upstream
// `@nativescript/core` (`check/ns-core.d.ts`; the slice in `src/ns-core.d.ts` is not emitted).
// `check:consumer` compiles this against `lib/types`: `GtkSource.View`
// must satisfy `ViewBase`, or `page.getViewById<InstanceType<typeof GtkSource.View>>()` is TS2344.

import type { ViewBase } from '@nativescript/core';
import type { GtkSource } from '@gjsify/gtksource-nativescript';

type SourceView = InstanceType<typeof GtkSource.View>;

export declare function getViewById<T extends ViewBase>(id: string): T | undefined;

export const sourceView = getViewById<SourceView>('sourceView');

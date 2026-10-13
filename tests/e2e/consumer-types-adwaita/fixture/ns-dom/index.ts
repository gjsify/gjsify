import type { Canvas2DBridge } from '@gjsify/adwaita-nativescript/canvas2d';
import type { GtkSource } from '@gjsify/gtksource-nativescript';

export type Frame = Parameters<Canvas2DBridge['requestAnimationFrame']>[0];
export type SourceView = InstanceType<typeof GtkSource.View>;

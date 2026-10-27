// The read side of `Gdk.RGBA`, renderer-free: what `Adw.StyleManager.get_accent_color_rgba()` and
// `Adw.AccentColor.to_rgba()` hand back. A TRUE SUBSET of `gi://Gdk` — `red`/`green`/`blue`/`alpha`
// (0…1), `to_string()` in GDK's `rgb(r,g,b)` spelling and `equal()`; parsing and the rest are absent.
//
// Reference: gtk gdk/gdkrgba.c#gdk_rgba_to_string
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

export interface RGBAInit {
    red: number;
    green: number;
    blue: number;
    alpha: number;
}

export class RGBA {
    red: number;
    green: number;
    blue: number;
    alpha: number;

    constructor(init: Partial<RGBAInit> = {}) {
        this.red = init.red ?? 0;
        this.green = init.green ?? 0;
        this.blue = init.blue ?? 0;
        this.alpha = init.alpha ?? 0;
    }

    equal(other: RGBA): boolean {
        return (
            this.red === other.red &&
            this.green === other.green &&
            this.blue === other.blue &&
            this.alpha === other.alpha
        );
    }

    to_string(): string {
        const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
        const rgb = `${channel(this.red)},${channel(this.green)},${channel(this.blue)}`;
        return this.alpha === 1 ? `rgb(${rgb})` : `rgba(${rgb},${Number(this.alpha.toFixed(3))})`;
    }
}

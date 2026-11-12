// The text size an editor gets when nothing sets one, in device-independent units.
//
// GNOME's 11 pt UI font read at 96 dpi: 11 x 96/72 = 14.67. It is the size the Adwaita theme
// derives the whole ramp from (`@gjsify/adwaita-nativescript`, #2555), so prose and code agree.
// The unit is the one a NativeScript `fontSize` has: sp on Android (the platform scales it by the
// user's font scale), points on iOS (which the driver does not scale a second time).
export const DEFAULT_FONT_SIZE = 14.67;

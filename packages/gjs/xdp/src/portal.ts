// The Linux body: libportal's own types, re-exported (ADR 0144 § 3). No gjsify object sits
// between the app's call and the typelib, so `Xdp.Portal` here IS `XdpPortal`.

import Xdp from 'gi://Xdp?version=1.0';
import XdpGtk4Library from 'gi://XdpGtk4?version=1.0';

export const Portal = Xdp.Portal;
export type Portal = InstanceType<typeof Xdp.Portal>;
export const BackgroundFlags = Xdp.BackgroundFlags;
export type BackgroundFlags = Xdp.BackgroundFlags;

/** `XdpGtk4.parent_new_gtk`, real here and `null` on the platforms that show no portal dialog. */
export const XdpGtk4 = { parent_new_gtk: XdpGtk4Library.parent_new_gtk };

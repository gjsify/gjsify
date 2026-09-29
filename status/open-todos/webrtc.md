<!-- Authored Open-TODO sections — area: @gjsify/webrtc.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### WebRTC showcases (extended)

`webrtc-loopback` is a published showcase. Open follow-ups: `webrtc-video` could be a second showcase (getUserMedia + media pipeline; needs camera-permission UX — separate workstream); `webrtc-dtmf` / `webrtc-states` / `webrtc-trickle-ice` remain private reference implementations for specific spec behaviors, not end-user showcases.


### `@gjsify/webrtc` cannot work on Alpine / postmarketOS — no `webrtcbin` element

Separate from the libc axis and easy to mistake for it. The musl leg's
committed-prebuild check reports `webrtc-native` as fully resolving, which is true
and misleading: `gst-plugins-bad` provides `libgstwebrtc-1.0.so.0`, so every
relocation binds, while `gst-inspect-1.0 webrtcbin` on the same image finds
nothing. GStreamer 1.28's nice plugin requires libnice >= 0.1.23 and Alpine ships
0.1.22, so the `webrtcbin` element and the `nice` plugin are not built at all.
Measured on `alpine:3.24`: library present, element absent, nice plugin absent.
Installing `libnice` does not help and that is measured too — with
`libnice-0.1.22-r0` genuinely installed from community, `/usr/lib/gstreamer-1.0/`
still contains no nice plugin at all, so `nicesrc`/`nicesink`/`webrtcbin` remain
missing. Alpine's libnice package simply does not build the GStreamer plugin, and
the phone does not even have libnice installed.

`@gjsify/webrtc` is built entirely on `webrtcbin`, so it is non-functional on
Alpine and on postmarketOS regardless of the prebuild. Layering the postmarketOS
repositories on top of Alpine does not help, and that is measured, not assumed:
on a real postmarketOS v26.06 device with the pmOS mirrors active, `libnice` is
still 0.1.22-r0 (taken from Alpine community unchanged) and
`Gst.ElementFactory.find()` finds no `webrtcbin`, `nicesrc` or `nicesink`, while
`dtlssrtpenc` and `rtpbin` are both present — exactly the shape a libnice-gated
nice plugin produces. Nothing to fix here; the blocker is a distro package
version, and the upstream threads say a maintainer MR bumping libnice plus a
`gst-plugins-bad` rebuild is all it takes:

- https://gitlab.postmarketos.org/postmarketOS/pmaports/-/work_items/4443
- https://gitlab.alpinelinux.org/alpine/aports/-/work_items/18092

Worth tracking because it is the one bridge whose prebuild can be perfect and
still unusable on a whole libc's worth of hosts, and because the reflex fix —
teaching the musl check to verify GStreamer elements — would be an accepted gap
from day one. Revisit when Alpine's libnice reaches 0.1.23; the right check then
is a real element probe, which would go green rather than being born red.


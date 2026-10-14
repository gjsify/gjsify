# 114. Edition badges: open source for every build, purchased on top for store builds

- Status: **Proposed** (UI placement) · **Accepted** (the `@gjsify/distribution` API)
- Date: 2026-10-14
- Deciders: Pascal Garber
- Related: [ADR 0113](0113-distribution-channel-gates-donation-ui.md) (channel, capability table);
  `packages/framework/distribution/src/index.ts`

## Context

Learn6502 and Steuererklärung want to say two things about the running build. Every build is open
source, and the user should be thanked for using open source software. A build the user bought in a
store should say more: that buying it supported the open source project. Free builds must not
claim a purchase.

## Decision

1. **Two badges.**
   - **Open Source**, shown by every build, with a thank-you for using open source software.
   - **Purchased**, shown only by a bought build, in addition to the first. Store channels today:
     `microsoft-store`, `apple-app-store`; Google Play joins as a new table row.
   Free builds (flathub, web, unknown/dev, deb/rpm/AppImage, Windows installer and portable, macOS
   `.app`) show the open-source badge only.

2. **Capability, not channel name.** `ChannelCapabilities` gains `purchased: boolean`, true only for
   the two store channels. `@gjsify/distribution` exports `purchased()` and `purchasedFor(channel)`,
   mirroring `donationsAllowed()` / `donationsAllowedFor()`. Apps call these and never compare the
   channel name (ADR 0113 § 3).

3. **`unknown` never claims a purchase.** An unset channel reports `purchased() === false`. Wrongly
   thanking someone for a purchase they did not make is worse than omitting a thank-you.

4. **Wording rules.** Say "Support" and "supported this project by buying the app". Never
   "donation" / "Spende" for the purchase badge. No claim about tax-deductibility, anywhere.

5. **Where the UI lives: open.** For now each app decides the placement (About dialog, a settings
   row). Candidate: a shared helper next to the framework's About helper that renders both badges
   from the two capabilities, once a second app has built its own and the shape is clear.

## Consequences

- Adding a store (Google Play) is one table row; no app changes.
- A purchased build keeps the code for its badge, a free build drops it: `purchased` is a
  compile-time constant through `__GJSIFY_CHANNEL__`.

## Open gap

Only `flatpak` implies a channel (`flathub`, ADR 0113 § 2). deb/rpm/AppImage, MSI and macOS builds
therefore report `unknown`: they correctly show no purchased badge, but they are free builds whose
donation link is hidden anyway. Fix candidates: the app sets `gjsify.ship.channel: "web"` as its
project default, and the store builds pass `--channel microsoft-store|apple-app-store` explicitly.
Not decided here; it belongs to the per-app release setup.

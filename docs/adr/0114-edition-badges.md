# 114. Edition badges: open source for every build, purchased on top for paid builds

- Status: **Accepted** (the `@gjsify/distribution` API; UI placement stays open, see Decision 5) —
  **amended 2026-11-10** by [ADR 0139](0139-support-and-purchase-in-stores.md): the purchase badge is
  gated by `pricing() === 'paid'`, not by the store channel.
- Date: 2026-10-14
- Deciders: Pascal Garber
- Related: [ADR 0113](0113-distribution-channel-gates-donation-ui.md) (channel, capability table);
  [ADR 0139](0139-support-and-purchase-in-stores.md) (support paths, store purchases and pricing);
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

2. **Capability, not channel name.** `ChannelCapabilities` carries `support` and `commerce`
   (ADR 0139 § 1). The "Purchased" badge is shown when `pricing() === 'paid'`, so every free build —
   including every free store build — shows the open-source badge alone. `@gjsify/distribution`
   exports `supportPath()`, `pricing()` and the deprecated `purchased()` / `purchasedFor(channel)`
   shims. Apps call the capability helpers and never compare the channel name (ADR 0113 § 3).

3. **`unknown` never claims a purchase.** An unset channel reports `purchased() === false`. Wrongly
   thanking someone for a purchase they did not make is worse than omitting a thank-you.

4. **Wording rules.** Say "Support" and "supported this project by buying the app". Never
   "donation" / "Spende" for the purchase badge. No claim about tax-deductibility, anywhere.

5. **Where the UI lives: open.** For now each app decides the placement (About dialog, a settings
   row). Candidate: a shared helper next to the framework's About helper that renders both badges
   from the two capabilities, once a second app has built its own and the shape is clear.

## Amendment 2026-11-10 — purchased is gated by pricing, not the channel

[ADR 0139](0139-support-and-purchase-in-stores.md) § 5 amends this ADR. The original table made
`microsoft-store` and `apple-app-store` claim a purchase because those channels were planned to be
paid-only. The plan changed: every existing app is free in every channel, and store purchases become
voluntary in-app tips managed by `@gjsify/store`. The "Purchased" badge is therefore shown when
`pricing() === 'paid'` (the build came from a paid listing), not when `channel` is a store. The
wording rules in § 4 stay unchanged.

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

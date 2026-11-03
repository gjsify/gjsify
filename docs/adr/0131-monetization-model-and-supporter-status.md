# 131. A build declares its monetization model; only "has this user paid" is decided at runtime

- Status: **Accepted** (the model, the build/runtime split and the package boundary; the per-store
  code-redemption rule stays open, see Open gap)
- Date: 2026-11-03
- Deciders: Pascal Garber
- Related: [ADR 0113](0113-distribution-channel-gates-donation-ui.md) (channel, capability table);
  [ADR 0114](0114-edition-badges.md) (edition badges, extended here);
  [ADR 0130](0130-credits-come-from-the-git-history.md) (`credits.json`, whose `supporters` list
  this ADR feeds); `packages/framework/distribution/src/index.ts`

## Context

ADR 0114 ties "purchased" to the channel: a Microsoft Store or App Store build is a bought build,
every other build is free. That covers one business model. The apps built with gjsify need three:

- **paid** — the app is sold; whoever has the package has paid.
- **supporter** — the app is free everywhere; a user can pay once (an in-app purchase in a store, a
  signed code after a direct donation elsewhere) and is thanked with a supporter badge and, if they
  opt in, a line in the credits.
- **free** — no payment path at all.

Orthogonal to that, an app may be open source or closed source, and the "Open Source" badge of ADR
0114 must follow the license, not the channel. And the same app can use different models in
different channels: free with supporters on Flathub and Google Play, sold in the Microsoft Store.

## Decision

1. **The model is build-time configuration.** `gjsify.ship.monetization` in `package.json` is the
   project default; `gjsify.ship.channels.<channel>.monetization` overrides it per channel;
   `gjsify build|ship --monetization <model>` overrides both. The CLI turns the result into the
   define `__GJSIFY_MONETIZATION__`, next to `__GJSIFY_CHANNEL__`. An unset model is `free`.

2. **Build time knows everything except the user.**

   | Fact | Known | Source |
   |---|---|---|
   | channel | build | `__GJSIFY_CHANNEL__` (ADR 0113) |
   | monetization model | build | `__GJSIFY_MONETIZATION__` |
   | open source | build | the SPDX `license` of `package.json`, else `project_license` of the metainfo |
   | credits, including the supporter list | build | `credits.json` (ADR 0130) |
   | has *this* user paid | **runtime**, `supporter` model only | in-app purchase receipt or signed code, stored locally |

   In the `supporter` model every user downloads the same free package; a later purchase or code
   cannot change the installed package, so only that one fact is a runtime question. In `paid` it
   is a constant again: whoever runs the package bought it.

3. **Capabilities, not channel names** (ADR 0113 § 3, extended). `ChannelCapabilities` becomes
   `{ donationLinks, inAppPurchase, externalCodes, sellable }`:
   - `donationLinks` — may the app link to or mention an external way to pay (today's `donations`);
   - `inAppPurchase` — does the channel offer a store billing API;
   - `externalCodes` — may the app redeem a code bought outside the store;
   - `sellable` — can the app be sold as a paid listing.

   New rows: `google-play` and `f-droid`. F-Droid has no billing and no paid listings, and its
   inclusion policy rejects proprietary billing libraries.

4. **Invalid combinations fail the build.** `paid` on a channel that is not `sellable`; `supporter`
   on a channel with neither `inAppPurchase` nor `externalCodes`; `inAppPurchase` code pulled into
   an `f-droid` build. The error names the channel, the model and the capability that is missing.

5. **Unused code is dropped, not hidden.** The bundler substitutes both defines, so a `free` build
   contains neither billing nor code verification, a `paid` build no purchase UI, an `f-droid` build
   no billing library, and a closed-source build no "Open Source" badge.

6. **Package boundary.**
   - `@gjsify/distribution` stays pure TS and build-time only: `channel`, `monetization`,
     `openSource`, the capability table, and the validation the CLI runs.
   - `@gjsify/supporter` (new) is the runtime part and is only bundled for `supporter` and `paid`:
     `SupporterStatus { supporter, via: 'paid-build' | 'in-app-purchase' | 'code', name?, since? }`
     from interchangeable sources — `PaidBuildSource` (constant), `CodeSource` (Ed25519, offline),
     `PlayBillingSource` (`.android.ts`), `StoreKitSource` (`.ios.ts`). Store purchases are
     re-queried at start so a reinstall restores the status.
   - Supporter codes are `{v, app, tier, name?, date}` signed with Ed25519, base32 in typing-friendly
     groups. The app holds only the public key; the private key never enters a repository. The CLI
     gets `gjsify supporter keygen|issue|verify`.

7. **ADR 0114 is extended, not replaced.** Its "purchased" badge is the `paid` case and is now
   reported as `SupporterStatus` with `via: 'paid-build'`. `purchased()` stays as a deprecated alias
   for `monetization === 'paid'` until its callers move. The wording rules of 0114 § 4 apply to every
   `via`: "supported this project", never "donation" for a purchase, no tax claim.

8. **Supporters in the credits are opt-in.** A supporter appears in `credits.json` only with their
   consent and under the name they chose; issuing a code asks for both. The user's own name shows
   at once after redeeming; the list of everyone ships with the next release.

## Consequences

- Any combination is one configuration line: a sold closed-source app, a free open-source app with
  supporters, a free app, or a mix per channel.
- Adding a store stays one table row; a store with billing additionally needs one source in
  `@gjsify/supporter`.
- The billing libraries become conditional dependencies of the Android/iOS build, keyed on
  `inAppPurchase` and the model; this is build work in the CLI, not app work.

## Implementation

1. `@gjsify/distribution`: `Monetization`, `monetization`, `openSource`, the new capability fields
   and rows, `validateDistribution()`; specs per channel × model.
2. CLI: `--monetization`, `gjsify.ship.channels.<id>`, the define, the validation error, `openSource`
   from the license.
3. `@gjsify/supporter`: code format, verification, `gjsify supporter keygen|issue|verify`, status
   store, source interface. Learn6502 builds the badge, code entry and store purchases first; the
   parts that prove stable move here.

## Open gap

Whether `externalCodes` is true for `google-play` and `apple-app-store` is not decided here. The
working assumption — Apple App Review Guideline 3.1.3(b) "Multiplatform Services" allows unlocking
what was bought elsewhere if the same item is also offered as an in-app purchase, Google Play's
payments policy allows consuming content bought outside the app, and neither allows the app to
point to the outside purchase — is to be checked against the current guideline texts before the
first store build ships codes. Until then both rows default to `externalCodes: false`.

# 139. One support path per channel, and store purchases behind one provider interface

- Status: **Proposed**
- Date: 2026-11-10
- Deciders: Pascal Garber
- Related: [ADR 0113](0113-distribution-channel-gates-donation-ui.md) (the channel and its capability
  table), [ADR 0114](0114-edition-badges.md) (edition badges — § 5 amends it),
  [ADR 0135](0135-store-listings-come-from-the-metainfo.md) (listings),
  [ADR 0124](0124-ship-writes-a-release-record-per-artifact.md) and
  [ADR 0126](0126-ship-credentials-and-a-jsign-windows-signer.md) (`gjsify ship`, signing),
  `packages/framework/distribution/src/index.ts`; consumer: steuererklaerung issue #62

## Context

ADR 0113 gave a build its distribution channel and one capability, "may this build show a donation
link". ADR 0114 added a second, "was this build bought". Both are compile-time constants derived from
`__GJSIFY_CHANNEL__`, and both were written for a plan that has since changed.

The plan now: **the apps are free, in every channel.** There is no paid edition of steuererklärung.
Where a store forbids an external support link, the link is hidden and replaced by whatever that
store does allow — in practice an in-app purchase that buys nothing but a thank-you. Apps that are
*sold* are still expected later, so the core needs purchase, licence state and restore per store.

That breaks two things in today's model:

- **`donationsAllowed()` is a yes/no where the answer has three values.** On `apple-app-store` the
  honest answer is not "no donations" but "not as a link — as an in-app purchase". A boolean can only
  express the half of that which hides UI, so a store build shows nothing at all today.
- **`purchased()` is now false and still returns true.** It reads `true` for every
  `microsoft-store` and `apple-app-store` build because those channels were going to be paid ones. A
  free download from the Microsoft Store was not bought, and ADR 0114 § 3's own rule — "wrongly
  thanking someone for a purchase they did not make is worse than omitting a thank-you" — says the
  value is wrong, not merely stale. Ownership is a question about a *user*, which no build-time
  define can answer.

The rules that bind this (wording checked against the primary sources on 2026-11-10; both vendors
edit them, so re-read them before the first store submission):

- **Apple, App Review Guidelines 3.1.1:** "you must use in-app purchase"; "Apps may not use their
  own mechanisms to unlock content or functionality, such as license keys, …"; "Apps may use in-app
  purchase currencies to enable customers to 'tip' the developer or digital content providers in the
  app." 3.1.1(a) permits buttons and external links to other purchase mechanisms only with the
  External Purchase Link entitlement or on the United States storefront. So: a tip jar is allowed
  **only** through IAP, and a licence key is forbidden as an unlock mechanism.
- **Microsoft Store Policies 10.8.1:** games and Xbox must use the Store IAP API, while
  "Non-game products made available on PC devices may either use a secure third-party purchase API
  or the Microsoft Store in-product purchase API". A voluntary donation that returns digital goods or
  services — "including but not limited to additional features or removal of advertising" — counts as
  a purchase. **10.8.2:** "You must use the Microsoft payment request API or a secure third-party
  purchase API to receive voluntary donations from users. However, if the user receives digital goods
  or services in return … you must use the Microsoft Store in-product purchase API instead."
- **What 10.8.2 does not say** is whether a button that opens the browser on a sponsors page is
  permitted. It regulates payments *collected in the product*, and a link collects none; it also does
  not exempt one. ADR 0113 recorded the Microsoft policy as unverified. It is now read, and the
  specific question is still **unresolved** — treated below as unresolved, not as permitted.

One consequence for ADR 0114: if a donation returns anything — a "Supporter" badge, a quieter app —
then under 10.8.1 it is a purchase and the Microsoft Store IAP API becomes mandatory for it. The
badge is not free of policy.

Technically, the desktop store builds are the ones that cannot reach a store API today. Flathub and
the web builds are GJS; Windows and macOS builds run the Node variant on node-gi, and both store
APIs are native-only: `Windows.Services.Store` is WinRT, StoreKit is Swift/Objective-C. Neither has a
maintained Node binding.

## Decision

### 1. The channel declares a support *path*, not a donation boolean

`ChannelCapabilities` is replaced, not extended:

```ts
export type SupportPath = 'external-link' | 'store-purchase' | 'none';
export type Commerce = 'microsoft' | 'apple' | 'none';

export interface ChannelCapabilities {
    /** How a user may support the project in this channel. */
    support: SupportPath;
    /** Which store commerce backend this channel has. */
    commerce: Commerce;
    /** May the app unlock itself with its own licence key or account. */
    ownLicensing: boolean;
}
```

| Channel | `support` | `commerce` | `ownLicensing` | Why |
|---|---|---|---|---|
| `flathub` | `external-link` | `none` | yes | Flathub processes no payments; the metainfo carries the donation URL |
| `web` | `external-link` | `none` | yes | our own site, our own rules |
| `microsoft-store` | `none` | `microsoft` | yes | link status unresolved (§ Context); 10.8.1 leaves non-game PC apps a free choice of purchase API |
| `apple-app-store` | `store-purchase` | `apple` | **no** | 3.1.1: tip through IAP only, licence keys forbidden |
| `unknown` | `none` | `none` | no | a development build stays quiet (ADR 0113 § 4) |

`microsoft-store` keeps the **conservative default**, `none`, for the reason ADR 0113 § 4 gave: a
support link that turns out to be disallowed costs a rejection and a review cycle, while a missing one
costs a link. It is a one-row change the day the question is answered, and the answer is open question
1 below. No `snap` or `google-play` row is added speculatively; a row is added when a build ships
there.

**`supportPath()` stays synchronous and compile-time constant**, because that is what makes the
bundler drop the other branch — the whole point of `__GJSIFY_CHANNEL__`. It answers what the channel
*permits*. What is actually *offerable* right now (is a provider registered, do the products load, is
the store reachable) is a runtime question and belongs to § 2's `resolveSupport()`.

**Backwards compatibility.** `donationsAllowed()` / `donationsAllowedFor()` stay, `@deprecated`,
defined as `supportPath() === 'external-link'`, and are removed in the next major. Every call site in
this repo moves in the same PR. `purchased()` cannot be kept honest that way, so:

- A second build-time define, `__GJSIFY_PRICING__` from `gjsify.ship.pricing` (`free` | `paid`,
  default `free`), says whether *this build came from a paid listing*. `pricing()` exports it.
  A paid listing is the one case where "the user bought this" is true by construction, so it stays a
  compile-time constant and ADR 0114's badge keeps its dead-code elimination.
- `purchased()` stays, `@deprecated`, and now returns `pricing() === 'paid'`. For every app that
  exists today that is `false` in every channel, which is the fix, not a regression.
- Whether *a given user* owns *a given product* is `@gjsify/store`'s `owns(id)`. Never a define.

### 2. `@gjsify/store`: one provider interface, one null provider, one memory provider

A new package, because `@gjsify/distribution` is pure TypeScript on every runtime and must stay that
way; a store provider is native code on exactly two platforms.

- **`@gjsify/store`** — tier 2, pure TS, runs everywhere: the types, the product catalogue, the
  registry, the entitlement cache, the unavailable provider.
- **`@gjsify/store/testing`** — the memory provider.
- **`@gjsify/store-microsoft`, `@gjsify/store-apple`** — tier 1, native, `node` runtime only, with
  per-platform prebuild packages exactly as `packages/node/*-native` and node-gi's own addon do.

```ts
export interface StoreProvider {
    readonly id: Commerce;
    products(ids: readonly string[]): Promise<readonly StoreProduct[]>;
    purchase(id: string, ctx: PurchaseContext): Promise<PurchaseResult>;
    entitlements(): Promise<readonly Entitlement[]>;
    restore(): Promise<readonly Entitlement[]>;
}

export type PurchaseResult =
    | { status: 'purchased'; entitlement: Entitlement }
    | { status: 'already-owned'; entitlement: Entitlement }
    | { status: 'cancelled' }
    | { status: 'pending' }
    | { status: 'unavailable'; reason: StoreUnavailable };
```

- **A cancelled purchase is a result, not an exception.** A user closing the store dialog is the
  common case; a thrown error there produces a crash report per cancellation. Only a programming
  error throws (`StoreConfigError`: an unknown product id, a product declared for a channel whose
  `commerce` is `none`).
- **`PurchaseContext` carries the parent window.** Verified for Windows: a packaged Win32 app must
  cast `StoreContext` to `IInitializeWithWindow` and pass the owner HWND, or the object "will return
  inaccurate data or errors". So the interface takes the window from the start rather than growing a
  Windows-shaped parameter later; the GTK host resolves it from the `Gdk.Surface`.
- **Products are declared, not hardcoded.** `gjsify.store.products` in `package.json`:
  `{ id: 'support.small', kind: 'tip' | 'unlock', stores: { microsoft: '9N…', apple: 'eu.jumplink.…' } }`.
  `id` is the app's own name for it and the only string in app code; the per-store ids live in config,
  because they are assigned by Partner Center and App Store Connect. `gjsify build` fails when a
  product is declared for a channel that has no commerce backend.
- **Registration is a declared side-effect import**, like every other platform backend:
  `import '@gjsify/store-microsoft/register'`, which the app's per-channel entry point carries. No
  ambient discovery, no env var (ADR 0134 § 4).
- **Nothing registered means `unavailable`.** The default provider answers `{ status: 'unavailable' }`
  and an empty entitlement list. `resolveSupport(): Promise<SupportOffer | null>` returns `null` then,
  and the shared About/success-prompt helpers render nothing. An `apple-app-store` build made before
  the Apple provider exists therefore shows no support UI — correct, and quiet.

**Testing without a store is mandatory, not a convenience.** Microsoft's own documentation states
that `Windows.Services.Store` has no simulator: an app must be published to the Store, downloaded
once onto the development machine for its licence, and only then tested. CI can never do that. So
`MemoryStoreProvider` is the provider every test and every CI leg uses, scripted by a fixture:
products, a purchase, a cancellation, an already-owned product, an unreachable store, and a restore
that returns a purchase made on another machine. The six outcomes are the test matrix for any app's
support UI, and `@gjsify/store` ships them as a shared suite so an app asserts its own UI against
them instead of inventing fixtures.

### 3. Native binding per store, and the order of work

Both providers are N-API addons loaded by node-gi's Node variant, built with `node-gyp` and shipped
as per-platform prebuild packages (`gjsify.platforms`, `gjsify.prebuilds` — the existing convention,
and node-gi already ships `win32-x64`, `win32-arm64`, `darwin-x64`, `darwin-arm64`). An N-API addon
is viable: it is what node-gi's own engine is, and the whole runtime these builds use is already one.

- **Microsoft.** C++/WinRT over `Windows.Services.Store`: `StoreContext.GetDefault()`,
  `GetStoreProductsAsync`, `RequestPurchaseAsync`, `GetAppAndOptionalPackagesLicensesAsync`.
  Requires a packaged app (Desktop Bridge / MSIX package identity) and the HWND initialisation above.
  IAP does not work in elevated processes. Add-ons are defined in Partner Center; a tip is a
  consumable, an unlock is a durable add-on. `gjsify ship` has no MSIX target today — that is the
  larger half of the work, not the addon.
- **Apple.** StoreKit through a Swift or Objective-C shim behind N-API. The Mac App Store needs App
  Store signing, the App Sandbox and IAP products in App Store Connect; `gjsify ship` today produces
  a notarized `.dmg` (ADR 0126), which is a different artifact and a different signature. Assumed,
  not verified: that StoreKit 2 has no C or Objective-C surface and only StoreKit 1 does.
- **Flathub and web** get no provider, ever: there is no store to call. Their support path is the
  link they already have, and a paid app there uses § 4's own licensing.

**Order.** The first store *listing* gates all of it, and the recommendation is Microsoft first
(§ open question 3): the Windows build chain already signs (ADR 0126), and an individual Partner
Center account is the cheaper entry. That puts open question 1 on the critical path, and it is free
to ask. Apple's provider lands with Apple's listing, and until then an Apple build shows no support
UI by § 2's rule.

Three spikes, each ending in a report under `docs/reports/`:

1. **Microsoft policy (no code).** Ask Store certification support, in writing, whether a free
   non-game PC app may show a button that opens the browser on a sponsors page, and whether a tip
   consumable that grants nothing is acceptable. **Abort:** no written answer in 14 days → the
   `microsoft-store` row stays `none` and the IAP tip jar becomes the only Microsoft path.
2. **`StoreContext` from node-gi.** A minimal addon in an MSIX-packaged node-gi app: reach
   `GetDefault()`, initialise with a real GTK window's HWND, and list one add-on from a hidden
   Partner Center submission. **Abort after 5 working days**, or earlier if MSIX identity cannot be
   produced for a node-gi app at all — then the Microsoft provider waits for the MSIX ship target
   and is not attempted from a loose build.
3. **StoreKit from node-gi.** A Swift or Objective-C shim behind N-API in a sandboxed,
   App-Store-signed build, buying one consumable with a sandbox tester. **Abort after 5 working
   days**, or earlier if Swift concurrency cannot be driven from the GLib main loop — the fallback is
   StoreKit 1's `SKProductsRequest` / `SKPaymentQueue`, which is Objective-C and callback-based.

Spikes 2 and 3 need a developer account of the maintainer's (open question 4). Spike 1 needs none.

### 4. Paid apps: one entitlement, two sources

An app asks `owns('pro')` and gets a boolean. Behind it:

- **`StoreProvider`** where `commerce !== 'none'`, and it is the *only* source on
  `apple-app-store` (3.1.1).
- **`KeyLicenseSource`** — a licence key or an account login — only where `ownLicensing` is true.
  Registering one in a channel that forbids it is a **build error**, not a runtime check: that is the
  difference between a failed build and a rejected submission.

**Offline.** An entitlement is cached in the app's data directory together with the signed payload
the store returned, and the cache alone decides at startup; nothing blocks on the network. A one-time
unlock never expires from the cache — locking a paying user out of an offline machine is a worse
failure than honouring a refunded purchase for a while. `restore()` exists for the other direction: a
new machine, an empty cache. Subscriptions and revocation are **out of scope** for v1 (§ 6): both
need a periodic re-check, and that needs a server.

### 5. Metainfo, badges, privacy

- **Metainfo** (ADR 0113 § 5): `<url type="donation">` is emitted when `support === 'external-link'`,
  which is the same gate under a new name. ADR 0135's test that no donation URL reaches a store
  listing stands unchanged.
- **Listings** (ADR 0135): a store that sells add-ons needs them declared in its own console.
  `gjsify … listing` gains a `products.md` per store, rendered from `gjsify.store.products`, so the
  console work is a checklist and not a memory exercise.
- **Badges — this amends ADR 0114 § 2.** "Purchased" stops being derived from the channel. It is
  shown when `pricing() === 'paid'`, so every free build — including every free store build — shows
  the open-source badge alone. ADR 0114's wording rules (§ 4: "supported this project by buying the
  app", never "donation", no tax claims) stay as they are. Whether a *tip* earns a badge is open
  question 2, and the recommendation is that it earns none.
- **Privacy — what leaves the device.** `@gjsify/store` opens no network connection of its own. A
  provider call goes to the store the user is already signed into on that machine, carrying product
  ids and the purchase the user just asked for; the payment dialog is the store's and the app never
  sees payment data. The entitlement cache is local. No server-side validation (Microsoft's
  collection REST API, Apple's server API) is used in v1, so no data reaches any server of ours —
  both would need an Azure AD or App Store Connect credential and a service to hold it, which is a
  new trust boundary and not in this ADR. An app that registers a provider names its store as a
  recipient on its privacy page.

### 6. What gjsify does NOT do

- **No legal advice.** The capability table encodes a reading of two rulebooks on one date, nothing
  more. `supportPath()` does not make a link compliant (ADR 0113's closing line, kept).
- **No pricing, no tiers, no currency handling.** Prices live in the store consoles; the provider
  reports the localised price string the store gives it.
- **No payment processing of its own**, and no bundled third-party payment SDK (Stripe, Paddle,
  LemonSqueezy). `KeyLicenseSource` is an interface an app implements against whatever it uses.
- **No subscriptions, no revocation, no receipt server** in v1.
- **No Snap or Google Play row** until a build ships there.
- **No provider for Flathub or the web.** There is nothing to call.

## Consequences

- An app asks one question — `resolveSupport()` — and gets the right answer per channel: a link, a
  purchasable product, or nothing. No app compares a channel name, and no app carries a store's rule.
- A store build grows a native dependency on exactly the two platforms that have a store, and keeps
  the pure-TS path everywhere else. `@gjsify/distribution` stays tier 2 and dependency-free.
- `purchased()` changes meaning for store builds, from `true` to `false`. That is a visible break and
  it is the bug being fixed; ADR 0114's badge keeps working through `pricing()`.
- The capability table now needs re-reading whenever *either* vendor edits its rules, and the two
  quoted paragraphs are the things to re-read. A changed answer is one table row.
- Microsoft's missing simulator makes the memory provider the only testable path in CI. That is a
  constraint on the interface — every outcome must be expressible as a fixture — and it is why the
  result union is explicit instead of a thrown error.

## Implementation

Each step is one PR with its acceptance criterion.

1. **`@gjsify/distribution`: the new capability shape.** `SupportPath`, `Commerce`, `ownLicensing`,
   `supportPath()` / `supportPathFor()`, `pricing()` and the `__GJSIFY_PRICING__` define,
   `donationsAllowed()` and `purchased()` deprecated and redefined, every call site in this repo
   moved. *Accept:* `purchasedFor('microsoft-store')` is `false` for a `free` build and `true` for a
   `paid` one; `supportPathFor()` returns § 1's table for all five channels; the deprecated pair
   still compiles and still answers the same thing for `flathub` and `web`; the metainfo gate reads
   `support`.
2. **`gjsify.ship.pricing` through the CLI.** The field, its schema, `--pricing`, the define wiring.
   *Accept:* an e2e build with `--pricing paid` tree-shakes the free branch out of the bundle, and
   the default build drops the purchased badge.
3. **`@gjsify/store` core plus `@gjsify/store/testing`.** The types, the catalogue, the registry, the
   unavailable provider, `resolveSupport()`, `owns()`, the entitlement cache, the six-outcome shared
   suite. No native code. *Accept:* the suite passes on Node and GJS against the memory provider; an
   unregistered provider yields `resolveSupport() === null`; a product declared for a `commerce:
   'none'` channel fails the build with a message naming product and channel.
4. **The About and success-prompt helpers move to `resolveSupport()`.** *Accept:* one app
   (steuererklärung, issue #62) renders a link on `flathub`, nothing on `apple-app-store` without a
   provider, and a purchase row against the memory provider — all three asserted in its own tests.
5. **Spike 1, the Microsoft policy question.** *Accept:* a written answer, or a dated record that
   none arrived in 14 days, in `docs/reports/`; either way the `microsoft-store` row is updated or
   explicitly confirmed as `none`, in this ADR.
6. **`gjsify ship --target msix`.** Package identity, the manifest, signing through the existing
   jsign path (ADR 0126), a release record (ADR 0124). *Accept:* an MSIX of a node-gi app installs on
   Windows and starts; the release record names its signature.
7. **Spike 2, then `@gjsify/store-microsoft`.** *Accept:* the spike's report; then the shared suite
   passes against the real provider on a Windows machine with a hidden submission, and
   `resolveSupport()` returns a purchasable tip product in a `microsoft-store` build.
8. **`products.md` in `gjsify … listing`.** *Accept:* `--check` fails when a declared product has no
   store id for a store that is being generated, per ADR 0135's error style.
9. **Spike 3, then `@gjsify/store-apple`**, with the Mac App Store ship target. *Accept:* as step 7,
   on macOS with a sandbox tester.
10. **`KeyLicenseSource`** — only when an app is actually to be sold (open question 5). *Accept:*
    registering it in an `apple-app-store` build fails the build; `owns()` answers from the cache with
    the network down.

Steps 1–4 are implementable now and depend on no account and no store. Steps 5–10 are sequenced
behind the first listing.

## Open questions for the maintainer

1. **May a free Microsoft Store build show an external support link?** 10.8.2 regulates payments
   collected in the product and says nothing about a link. *Recommendation:* keep `none` and ask
   certification in writing (step 5). If the answer is yes, Microsoft needs no provider at all and
   steps 7 and 6's urgency drop away — which is why this question is cheap and goes first.
2. **Does a tip grant anything?** A "Supporter" badge or a quieter app is, under Microsoft 10.8.1,
   "digital goods or services in return", which makes the Store IAP API mandatory for the tip and
   bars a third-party path. *Recommendation:* a tip grants **nothing but a thank-you**. It keeps one
   rule across all stores and keeps ADR 0114's badge set to the two it already has.
3. **Which store gets the first listing?** *Recommendation:* Microsoft — the Windows chain already
   signs, and the account is cheaper. It also means the MSIX target (step 6) is the next piece of
   ship work.
4. **Open a Microsoft Partner Center account now, and an Apple Developer Program account when?**
   Spikes 2 and 3 cannot start without them, and a payout account needs tax and bank data.
   *Recommendation:* Partner Center now for spike 2; defer Apple until spike 3's shim compiles
   locally, which needs no account.
5. **Is any app actually to be sold?** The interface in § 4 is designed now because retrofitting a
   licence model is the expensive case. *Recommendation:* land steps 1–4 and leave step 10 unbuilt
   until a paid app exists; an interface with no implementation is cheaper to change.

## Sources

**Verified at the primary source on 2026-11-10:** Apple App Review Guidelines 3.1.1 and 3.1.1(a);
Microsoft Store Policies 10.8.1 and 10.8.2 (v7.20); Microsoft Learn, *In-app purchases and trials*
(`StoreContext.GetDefault`, the `IInitializeWithWindow` HWND requirement for Desktop Bridge apps, the
add-on types, the absence of a simulator for `Windows.Services.Store`, no IAP in elevated apps, the
collection REST API for entitlement checks).

**Assumptions, not verified at the source** — each is a candidate to confirm before the step that
depends on it, and none of them changes § 1 or § 2:

- Flathub processes no payments and permits `<url type="donation">` and voluntary donations
  (this one is also ADR 0113's standing assumption and the current shipped behaviour).
- Apple 2.4.5(vi) (no licence screen at launch for Mac App Store apps), and that StoreKit 2 is
  Swift-only with no C or Objective-C surface, leaving StoreKit 1 as the shim fallback.
- Apple's and Microsoft's commission rates, the account types, and what tax or banking data a payout
  account needs.
- MSIX package identity being strictly required for `Windows.Services.Store` (the documentation
  requires a Desktop Bridge app, which implies it, but does not state the negative).
- The Microsoft collection REST API's Entra ID flow and Apple's App Store Server API shape — both
  only matter if v1's "no server" decision (§ 5) is ever revisited.
- The existence and maintenance state of third-party Node bindings (`electron-storekit`, Electron's
  `inAppPurchase`). § 3 assumes none is depended on and the addons are ours.
- Snap Store having no purchase API. It has no row in § 1 either way.

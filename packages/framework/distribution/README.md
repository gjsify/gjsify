# @gjsify/distribution

Where this build is distributed, and what that allows. Pure TypeScript, identical on GJS, Node and
the browser. The decision records are
[ADR 0113](../../../docs/adr/0113-distribution-channel-gates-donation-ui.md),
[ADR 0114](../../../docs/adr/0114-edition-badges.md) and
[ADR 0139](../../../docs/adr/0139-support-and-purchase-in-stores.md).

```ts
import { supportPath, pricing } from '@gjsify/distribution';

if (supportPath() === 'external-link') aboutDialog.add_link(_('Support the project'), SUPPORT_URL);
if (pricing() === 'paid') showPurchasedBadge();
```

## Channels

| `channel` | Meaning | `supportPath()` | `commerce` | `ownLicensing` |
|---|---|---|---|---|
| `flathub` | free, Flathub | `external-link` | `none` | yes |
| `web` | free download from the project's own site | `external-link` | `none` | yes |
| `microsoft-store` | listed in the Microsoft Store | `none` | `microsoft` | yes |
| `apple-app-store` | listed in the Apple App Store | `store-purchase` | `apple` | no |
| `unknown` | no channel declared (a development build) | `none` | `none` | no |

`supportPath()` answers what the channel *permits*. What is actually *offerable* right now
(registered provider, products loaded, store reachable) is a runtime question for
`@gjsify/store`'s `resolveSupport()`.

Edition badges ([ADR 0114](../../../docs/adr/0114-edition-badges.md)): every build shows "Open
Source"; `pricing() === 'paid'` adds the "you supported this project by buying the app" badge.
`unknown` never claims a purchase.

`donationsAllowed()` / `donationsAllowedFor()` and `purchased()` / `purchasedFor()` are kept as
`@deprecated` shims and will be removed in the next major version.

Ask the capability, never compare the channel name: a new channel is one row in
`CHANNEL_CAPABILITIES`, and no app changes. `supportPath()` is a policy answer, not legal advice.

## Setting the channel

At build time. `gjsify.ship.channel` in `package.json` is the project default;
`gjsify build --channel <id>` and `gjsify ship --channel <id>` override it. `gjsify ship --target
flatpak` implies `flathub` when nothing else says. The CLI turns it into the compile-time define
`__GJSIFY_CHANNEL__`, so a store build drops the donation code instead of hiding it at runtime.
The metainfo `<url type="donation">` follows the same channel.

An unset channel is `unknown` and shows no donation UI: a donation line in a store build can cost a
rejection, a missing one in a free build costs a link the maintainer notices.

## Pricing

`pricing()` reads the `__GJSIFY_PRICING__` define (`'free'` | `'paid'`, default `'free'`). A paid
listing is the one case where thanking the user for a purchase is true by construction; a free
store download is not a purchase.

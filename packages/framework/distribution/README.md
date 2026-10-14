# @gjsify/distribution

Where this build is distributed, and what that allows. Pure TypeScript, identical on GJS, Node and
the browser. The decision record is [ADR 0113](../../../docs/adr/0113-distribution-channel-gates-donation-ui.md).

```ts
import { channel, donationsAllowed, purchased } from '@gjsify/distribution';

if (donationsAllowed()) aboutDialog.add_link(_('Support the project'), SUPPORT_URL);
if (purchased()) showPurchasedBadge();
```

## Channels

| `channel` | Meaning | `donationsAllowed()` | `purchased()` |
|---|---|---|---|
| `flathub` | free, Flathub | yes | no |
| `web` | free download from the project's own site | yes | no |
| `microsoft-store` | sold or listed in the Microsoft Store | no | yes |
| `apple-app-store` | sold or listed in the Apple App Store | no | yes |
| `unknown` | no channel declared (a development build) | no | no |

Edition badges ([ADR 0114](../../../docs/adr/0114-edition-badges.md)): every build shows "Open Source";
`purchased()` adds the "you supported this project by buying the app" badge. `unknown` never claims a purchase.

Ask the capability, never compare the channel name: a new channel is one row in
`CHANNEL_CAPABILITIES`, and no app changes. `donationsAllowed()` is a policy answer, not legal advice.

## Setting the channel

At build time. `gjsify.ship.channel` in `package.json` is the project default;
`gjsify build --channel <id>` and `gjsify ship --channel <id>` override it. `gjsify ship --target
flatpak` implies `flathub` when nothing else says. The CLI turns it into the compile-time define
`__GJSIFY_CHANNEL__`, so a store build drops the donation code instead of hiding it at runtime.
The metainfo `<url type="donation">` follows the same channel.

An unset channel is `unknown` and shows no donation UI: a donation line in a store build can cost a
rejection, a missing one in a free build costs a link the maintainer notices.

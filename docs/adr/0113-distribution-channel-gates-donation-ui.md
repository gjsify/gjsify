# 113. A build-time distribution channel gates the donation UI

- Status: **Proposed**
- Date: 2026-10-13
- Deciders: Pascal Garber
- Related: `packages/infra/cli/src/utils/app-metadata.ts` (renders `<url type="donation">`);
  `packages/infra/cli/src/types/config-data.ts` (`donationUrl`); ADR 0024 (`gjsify ship`); ADR 0109
  (`@gjsify/site`, the landing page)

## Context

Apps built with gjsify (Learn6502, Beifahrer, Steuererklärung) ship free on Flathub and ask for
support in four places: an About-dialog link, a one-time "support the project" line after a success
moment (a submitted tax return), `FUNDING.yml`, and the metainfo `<url type="donation">`.

Some of these apps are meant to be sold in the Microsoft Store and the Apple App Store. There the
same prompts are wrong or forbidden:

- Apple's App Review Guideline 3.1.1 requires in-app purchase for anything that unlocks features or
  content. 3.1.1(a) lets apps on the **United States storefront** carry buttons and external links to
  other purchase methods without an entitlement; in every other storefront, "apps and their metadata
  may not include buttons, external links, or other calls to action that direct customers to
  purchasing mechanisms other than in-app purchase". The same guideline allows tipping, but only
  through in-app purchase currencies. A donation link is not obviously a purchasing mechanism, and
  reviewers differ on it; we do not plan around the benefit of the doubt. (Wording checked against
  <https://developer.apple.com/app-store/review/guidelines/> on 2026-10-13; Apple edits it, so
  re-check it when the first store build is due.)
- The Microsoft Store's policy on external payment and donation links has **not** been verified for
  this ADR. Until it is, the Microsoft channel is treated as strictly as the Apple one.
- A paid app that also asks for donations reads as wrong, whatever the policy says.

Today each app would have to hand-edit its About dialog, its success flow and its metainfo per store.
That is four edits per app per store, and the one forgotten becomes a rejection.

## Decision

1. **One build-time value, the distribution channel.** A closed set:

   | Channel | Meaning | Donation UI |
   |---|---|---|
   | `flathub` | free, Flathub | yes |
   | `web` | free download from the project's own site, a tarball, a Flatpak bundle | yes |
   | `microsoft-store` | sold or listed in the Microsoft Store | no |
   | `apple-app-store` | sold or listed in the Apple App Store | no |

   The names describe where the build is distributed, not what it may do. The capability lives in a
   table next to the type, so a channel can become "quiet" later without renaming it.

2. **Where it is set.** `gjsify.ship.channel` in `package.json` is the default for a project;
   `gjsify build --channel <id>` and `gjsify ship --channel <id>` override it. The CLI turns the
   value into a compile-time define (`__GJSIFY_CHANNEL__`, a string literal), so the bundler removes
   the dead donation code and strings from a store build instead of hiding them at runtime. A
   `ship` target may imply a default when no one states one: `flatpak` implies `flathub`. No other
   target implies a channel, because an MSIX or a `.app` can as well be sideloaded.

3. **How an app queries it.** One API, `@gjsify/distribution`:

   ```ts
   import { channel, donationsAllowed } from '@gjsify/distribution';

   if (donationsAllowed()) aboutDialog.add_link(_('Support the project'), SUPPORT_URL);
   ```

   `channel` is the typed string; `donationsAllowed()` reads the capability table. Apps ask the
   capability, never compare the channel name, so a new channel needs one table row and no app edit.
   The shared pieces the framework already provides (About dialog helper, the one-time support prompt)
   call `donationsAllowed()` themselves, so a standard app needs no code at all.

4. **Default: unknown means no donation UI.** A build with no channel set reports `channel ===
   'unknown'` and `donationsAllowed() === false`. The two failure modes are not equal: a donation line
   shown in a store build can cost a rejection and a review cycle; a missing line in a free build
   costs a link the maintainer notices the first time they open the About dialog. The Flathub path
   sets the channel through `ship --target flatpak`, so the free route needs no extra step. A
   development build shows no donation UI, which is also the quiet behaviour a contributor expects.

5. **The metainfo follows the channel.** `app-metadata.ts` omits `<url type="donation">` unless the
   channel allows donations. A store channel's metainfo, listing text and screenshots carry no
   donation URL. `donationUrl` stays in the config as the single source; the channel decides whether
   it is emitted. `FUNDING.yml` is a repository file, not part of a build, and stays.

6. **The landing page may list both.** `@gjsify/site` (ADR 0109) is a web page, not part of any
   store build. It may link the paid store version and the free Flathub version side by side and may
   show its own support section; that section is channel `web` by definition. What it must not do is
   put a link to the donation page into a *store listing's* metadata. A store listing links to the
   app's site only if the site's page for that app is acceptable under that store's rules, which is
   the app author's call per store.

## Consequences

- No app edits its About dialog, success flow or metainfo per store; the channel does it once.
- A store build is smaller by the donation strings and code, because the define is constant.
- A project that ships to Flathub must either use `ship --target flatpak` or set `gjsify.ship.channel`,
  or its Flathub build shows no donation UI. This is the price of the quiet default.
- The capability table needs a review whenever Apple or Microsoft change their wording; the cited
  guideline is the thing to re-read.
- `donationsAllowed()` is a policy answer, not legal advice: it does not make a donation link
  compliant in a channel that allows it.

## Implementation

**Not yet.** Proposed; implement when the first store build is due. The work then is: the
`@gjsify/distribution` package and its capability table, `--channel` on `gjsify build` and
`gjsify ship` plus the `gjsify.ship.channel` field and its schema, the define wiring, the metainfo
gate in `app-metadata.ts`, and moving the About-dialog and success-prompt helpers behind
`donationsAllowed()`. Verify the Microsoft Store policy first and record the result here.

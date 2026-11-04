# 135. Store listings come from the metainfo

- Status: **Proposed**
- Date: 2026-11-04
- Deciders: Pascal Garber
- Related: [ADR 0109](0109-a-static-site-generator-reads-an-app-from-its-metainfo.md) (`@gjsify/site`, whose
  parser, catalogue handling and image code this reuses), [ADR 0077](0077-browser-extensions-are-a-project-shape-not-a-runtime.md)
  (§7: `webext submit` is the next slice), [ADR 0113](0113-distribution-channel-gates-donation-ui.md)
  (no donation links in store listings), `packages/infra/site/src/listing/`

## Context

A browser extension is listed in up to three stores (Chrome Web Store, Edge Add-ons, Firefox AMO),
each wanting a name, a summary, a long description, screenshots at an exact size, an icon, a
privacy-policy URL and, for Chromium stores, a single-purpose statement and a justification per
permission. All of it is already written down: the AppStream metainfo carries name, summary,
description, URLs, branding and screenshots, and the app's gettext catalogues carry the translations.
Hand-written listings (Beifahrer's `docs/store/listing.md`) restate that and drift.

Not every consumer builds with `gjsify webext build` (Beifahrer has its own extension build), so the
command must not depend on it.

## Decision

`gjsify webext listing [--store cws|edge|amo|all] [--out dir] [--check]` reads a metainfo path and an
optional config and writes a ready-to-paste kit per store and language. The logic lives in
`@gjsify/site` (`src/listing/`) and reuses its metainfo parser, catalogue lookup (`loadCatalogs`,
`resolveLocalized`, `translator`), screenshot resolution and GdkPixbuf image backend; there is no
second copy. `gjsify site listing` reaches the same code; the CLI dispatch both share is
`utils/site-dispatch.ts`.

### Config

Only what the metainfo cannot carry lives in `gjsify.webext.listing` of the root `package.json`;
each key falls back to the `gjsify.site` one, and `--config <file>` overrides the block:

- `singlePurpose` and `permissions` (permission or host pattern → justification), as English msgids
  translated through the catalogues, as `gjsify site` does for page strings. A missing translation
  is a warning, a missing justification for a manifest permission on a store that asks is an error.
- `category` per store, `privacyUrl`, `screenshots` (a directory replacing the metainfo shots).

Privacy URL precedence: metainfo `<url type="privacy">`, then `privacyUrl`, then
`<siteUrl><lang>/privacy/` when `gjsify.site.privacy` is set. The donation URL is never emitted
(ADR 0113); a test pins that.

### Output

`<out>/<store>/<lang>/{name,summary,description}.txt`, `description.html` (AMO only),
`permissions.md` (CWS, Edge), `<store>/screenshots/*.png`, `<store>/icon*.png`, and `listing.json`
(`{ version: 1, app, stores: { <store>: { languages: { <lang>: entry }, screenshots, icon } } }`).
`--check` validates and writes nothing. `--pot <file>` writes the config strings as a gettext
template.

### Limits

Counted in code points. A violation fails with a message naming field, store, language and limit.
`verified: false` marks a number no first-party page states; it is still enforced, because a ceiling
set too low produces a message to fix while one set too high ships a rejection.

| Store | Field | Limit | Source | Verified |
|---|---|---|---|---|
| CWS | name | ≤ 75 | https://developer.chrome.com/docs/extensions/reference/manifest/name | yes |
| CWS | summary | ≤ 132 | https://developer.chrome.com/docs/extensions/reference/manifest/description | yes |
| CWS | description | ≤ 16,000 | https://developer.chrome.com/docs/webstore/cws-dashboard-listing | **no** |
| CWS | icon, screenshots | 128×128 PNG; 1280×800 or 640×400, 1–5 | https://developer.chrome.com/docs/webstore/images | yes |
| CWS | single purpose, per-permission justification | required | https://developer.chrome.com/docs/webstore/cws-dashboard-privacy | yes |
| Edge | name, summary | ≤ 75, ≤ 132 (read from the manifest, read-only in Partner Center) | https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension | **no** (Chromium manifest ceilings) |
| Edge | description | 250–10,000 per language | same | yes |
| Edge | logo, screenshots | 1:1, 300 recommended, 128 minimum; 640×480 or 1280×800, up to 6 | same | yes |
| Edge | category | required | same | yes |
| AMO | name, summary | ≤ 50, ≤ 250, no URLs in the summary | https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/ (numbers from addons-server `models.py`) | yes |
| AMO | screenshots | 1280×800 recommended; up to 10 is our choice | same | **no** |
| AMO | description markup | `p`, `ul`, `li` only | https://blog.mozilla.org/addons/2025/03/03/markdown/ | **no** (allowed tag list not found; conservative output) |
| AMO | description length | no limit enforced | — | **no** |

Promo tiles (CWS small 440×280, marquee 1400×560; Edge the same two sizes) are not generated yet;
CWS promo images are not localizable.

### Screenshots

Each screenshot is scaled to fit the store's canvas (1280×800 for all three) and letterboxed on the
`<branding>` light colour, white when absent. A shot needing more than a 2× enlargement is refused
with a message instead of being upscaled badly. Icons are rendered at the store's size from the
configured SVG or PNG.

### What the store APIs can set

| Store | Can set listing text and images | Source |
|---|---|---|
| CWS API v2 | **No.** Media upload (package), cancelSubmission, fetchStatus, publish, queryMetrics, rollback, ratings and reviews only | https://developer.chrome.com/docs/webstore/api/reference/rest |
| Edge Add-ons API | **No.** "There aren't REST API endpoints for … updating a product's metadata, such as the description" | https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api |
| AMO API v5 | **Yes.** `PATCH /addons/addon/<id>/` (translatable `name`, `summary`, `description`, `homepage`, `support_url`), icon by multipart PATCH, `POST …/previews/` for screenshots, `PATCH …/eula_policy/` for the privacy policy | https://mozilla.github.io/addons-server/topics/api/addons.html |

For CWS and Edge the kit is therefore the deliverable: a person pastes it into the dashboard.

## Later: `webext submit`

This slice does not upload anything. The `webext submit` of ADR 0077 §7 reads `listing.json` and the
files it names: for AMO it PATCHes each language's `name`, `summary` and `description.html`, then
uploads the icon and previews and sets the privacy policy; for CWS and Edge it uploads the package
only and prints which kit files still need pasting. The `version` field lets it refuse a kit it does
not understand.

## Consequences

- Store copy has one source, so the page, the metainfo and the listings agree after each release.
- The CWS and Edge text fields stay manual even after `submit`, by the stores' own design.
- Unverified limits are documented as such; each is a one-line change in `limits.ts` when a store
  page states it.

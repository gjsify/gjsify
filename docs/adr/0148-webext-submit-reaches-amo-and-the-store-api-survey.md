# 148. `webext submit` reaches AMO, and what every store's publishing API can do

- Status: **Proposed** (2026-11-19)
- Date: 2026-11-19
- Deciders: Pascal Garber
- Related: [ADR 0077](0077-browser-extensions-are-a-project-shape-not-a-runtime.md) (§7 and
  Amendment 1: the other two backends, the poll layer, the credential table),
  [ADR 0135](0135-store-listings-come-from-the-metainfo.md) (`store.json`);
  `packages/infra/cli/src/utils/webext/stores/amo.ts`

## Context

ADR 0077 shipped `gjsify webext submit` for the Chrome Web Store and Edge Add-ons and left AMO as
a declared slot with no backend. This ADR closes the slot and records, per store, whether an
official publishing API exists, so the next request is not another round of searching.

Honesty labels as in ADR 0077: **DOCUMENTED** = read in the vendor's page on 2026-11-19;
**UNVERIFIED** = from memory or a secondary source; **NOT MEASURED** = nothing here was sent to a
live store.

## Decision

### 1. AMO is an upload-then-create-version flow (addons-server API v5)

DOCUMENTED at <https://mozilla.github.io/addons-server/topics/api/addons.html>:

1. `POST /api/v5/addons/upload/` (multipart: `upload`, `channel=listed`) returns a uuid; validation
   runs asynchronously.
2. `GET /api/v5/addons/upload/<uuid>/` until `processed`; `valid=false` carries the `validation`.
3. `POST /api/v5/addons/addon/<id|slug|guid>/versions/` with `{upload: <uuid>}` creates the version.
4. A source archive can only travel as multipart (`source`), so it is a separate
   `PATCH …/versions/<id>/` after the create.

Auth is a JWT (<https://mozilla.github.io/addons-server/topics/api/auth.html>): HS256, `iss` = API
key, `jti` unique, `iat`, `exp` at most 5 minutes later, header `Authorization: JWT <token>`.
It is signed with `node:crypto`; no dependency is added.

### 2. The review gate: upload is the draft, `--submit` creates the version

Chrome and Edge keep an upload as a draft and ask for review only on `publish`. AMO has no draft
version: creating a listed version enters review at once. So the honest equivalent is:

- **without `--submit`**: upload with `channel=listed` and wait for validation. No version exists,
  nothing is in review. The result says "uploaded" (verdict `uploaded`), the same as Chrome/Edge.
  An upload stays unused on AMO's side; how long it remains usable is **UNVERIFIED**.
- **with `--submit`** (tags only, as before): create the version, which enters review.

An unlisted upload was rejected as the default: it produces a signed file, a different product,
and it would validate against a different channel than the one that is later published.

### 3. Names, and the add-on id

`AMO_ADDON_ID` (slug, numeric id or GUID; not secret), `AMO_WEB_EXT_API_KEY` (not secret: it is in
every token), `AMO_WEB_EXT_API_SECRET` (secret). The `AMO_` prefix keeps the table's
one-prefix-per-store rule; `web-ext` itself still reads `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET`
for `webext sign`, and a CI maps one onto the other. Accepting both names was not done: two names
for one secret doubles the redaction and documentation surface.

### 4. Source code

DOCUMENTED at <https://extensionworkshop.com/documentation/publish/source-code-submission/>:
reviewers must be able to read the code; where a build step (minifier, bundler) renders it hard to
read, the source and build instructions must be provided or the add-on may be rejected. gjsify
extensions are bundled, so this applies. It is therefore a flag, not a guess:
`--source <zip>` (AMO only, requires `--submit`, because it is attached to the version) — the
command never decides on the author's behalf whether the bundle needs it. A repository URL is not
accepted: the API field takes an archive.

### 5. `--dry-run`

One authenticated `GET /addons/addon/<id>/`; no upload. A 401 names the key, the secret and the
clock, a 403 the author permission, a 404 the add-on id.

### 6. Not done

Listing metadata (PATCH addon: summary, description, categories per locale) and screenshots
(`POST …/previews/`, multipart `image`) are DOCUMENTED in the API but not wired: the listing
comes from `webext listing` and its `store.json` still says what is filled by hand. Doing it
needs a mapping from `store.json` fields to AMO's translated fields, which is its own slice.
A listed version requires license, name, summary and categories to exist already; creating the
add-on itself stays a dashboard step, as for the other two stores.

## Survey: official publishing APIs

| Store | Official API | Package upload / submit | Listing metadata | Screenshots | gjsify |
|---|---|---|---|---|---|
| Chrome Web Store | yes, v2, OAuth 2.0 | upload, publish, fetchStatus, cancel, rollout %; cannot create an item | no (dashboard only) | no | `--store chrome` |
| Edge Add-ons | yes, v1.1, API key + client id | upload, publish, status; cannot create a product | no: "no endpoints for … updating a product's metadata" | no | `--store edge` |
| AMO | yes, addons-server v5, JWT | upload, version create, source; can create an add-on | yes (PATCH addon) | yes (previews) | `--store amo` (this ADR): upload, version, source; metadata and previews not wired |
| Opera Add-ons | none documented (UNVERIFIED: no official Opera page states it either way) | web form only | n/a | n/a | not implemented |
| Safari / App Store Connect | App Store Connect API for apps | the extension ships inside an app build; upload goes through Xcode/Transporter, not a web-extension API | yes (app metadata) | yes | not implemented |
| Thunderbird ATN | same server software as AMO (UNVERIFIED that the API is open there) | UNVERIFIED | UNVERIFIED | UNVERIFIED | not implemented |

Sources:

- Chrome Web Store: <https://developer.chrome.com/docs/webstore/using-api> (DOCUMENTED; the page
  states the API "can not create new items" and lists upload, publish, cancelSubmission, rollback,
  setPublishedDeployPercentage, fetchStatus).
- Edge Add-ons: <https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api>
  (DOCUMENTED; "There aren't REST API endpoints for creating a new product [or] updating a
  product's metadata").
- AMO: the addons-server pages above (DOCUMENTED). `signing.html` was unreachable (404/503 on
  2026-11-19), so the unlisted-signing flow was not re-read.
- Opera: <https://stackoverflow.com/questions/39017484/is-there-an-api-to-automate-uploading-of-opera-add-ons-to-addons-opera-com>
  ("no documented API"), <https://help.opera.com/en/extensions/publishing-guidelines> (form-based
  submission). A forum mention of an "available for auto-publishing" checkbox is UNVERIFIED and no
  API was found. A third-party tool (`@wext/shipit`) drives the web form; gjsify will not script a
  web form.
- Safari: <https://developer.apple.com/documentation/appstoreconnectapi> (the page body did not
  render in the fetch; the statement that a Safari web extension is distributed as an app and
  uploaded as a build is from knowledge, UNVERIFIED here). A Safari backend is a Xcode/signing
  project, not an HTTP one; out of scope.
- Thunderbird ATN: <https://developer.thunderbird.net/add-ons/about-add-ons> and the ATN source-
  code guide named in the search results; the API question was not answered by any page read.
  ATN is built on addons-server, so the AMO backend may work with a different API root; nothing
  was tried.

## Consequences

- `submit --store amo` works with the same exit codes, poll layer and redaction as the other two.
- The default stays "upload only, nothing in review"; the listed review is entered only by a tag
  run with `--submit`.
- Version-create on AMO answers directly, so a `--submit` run ends `in-review` without an
  operation to poll; `status()` reads the version's file status.
- NOT MEASURED against a live add-on. Open: the shape of `validation` (read defensively), the
  lifetime of an unused upload, and that `GET …/versions/v<number>/` answers 404 for an unknown
  version (used for the "already there" check). The `v` prefix is documented (a dotless number is
  otherwise read as an id). The JWT claims were re-read in `auth.rst` and match; `<addon>` accepts
  id, slug or GUID (documented).

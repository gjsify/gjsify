# 153. An app declares how much AI built it, in its metainfo

- Status: **Accepted** (2026-11-24)
- Date: 2026-11-24
- Deciders: Pascal Garber
- Related: [ADR 0109](0109-a-static-site-generator-reads-an-app-from-its-metainfo.md) (the site reads
  the app from its metainfo), `packages/infra/site`, `gjsify webext listing`

## Context

Apps built with gjsify are largely written by AI agents under the author's direction. Flathub has
required since 2026-09-04 that submitters disclose AI-generated material, "identifying the affected
parts and approximate extent". The disclosure belongs where every consumer of the app already looks:
the AppStream metainfo, which feeds the Flathub listing, `gjsify site` and the browser-store listing.

AppStream has no field for it. The standard extension point is `<custom><value key="…">`, which
`appstreamcli validate` accepts. It also rejects a repeated key (`custom-key-duplicated`), so a
disclosure cannot carry `xml:lang` siblings.

## Decision

Two keys in `<custom>`, namespaced `gjsify::`:

```xml
<custom>
  <value key="gjsify::ai-involvement">agent-built</value>
  <value key="gjsify::ai-disclosure">Which parts AI produced and how the author reviews and tests them.</value>
</custom>
```

`gjsify::ai-involvement` is a closed set:

| Value | Meaning |
|---|---|
| `none` | written without generative AI |
| `assisted` | mostly hand-written; AI helps in places |
| `agent-built` | AI agents implement the author's requirements, ideas and tests; the author directs, reviews and tests |

An unknown value warns and shows nothing; it is never guessed. An absent key shows nothing: no fact
is faked, as for every other badge. `gjsify::ai-disclosure` without a level is ignored with a warning.

**Translation.** The disclosure is one untranslated sentence in the metainfo, and the site translates
it through the app's own catalogues (`gjsify.site.translations`), the path that already translates
names, summaries and descriptions. The disclosure sentence is the msgid.

**Surfaces.** The site shows a "Development" badge (title = the disclosure) and prints the sentence
below the badge row, readable without JavaScript or hover. The extension page lists it among its
details. `gjsify webext listing` appends the translated sentence to the generated store description.

## Consequences

- One declaration serves Flathub, the site and the browser stores; none can drift from the others.
- The `gjsify::` keys are ignored by every other AppStream consumer.
- Adding a level is an ADR amendment plus a msgid; a typo cannot silently become a claim.

## Implementation

`site-data/metainfo.ts` (`parseAiInvolvement`), `site-data/types.ts` (`AiInvolvement`),
`render/pages.ts` (`aiInvolvementFacts`, `badges`), `render/extension.ts`, `listing/build.ts`.

# The `next` channel — running an app against `main`

> The decision, its alternatives and what the channel does NOT cover:
> ADR [0111](adr/0111-next-prerelease-channel.md). The release channel and its bootstrap rules:
> [publishing.md](publishing.md).

Every night at 03:00 Europe/Berlin, `main`'s HEAD is republished as the whole npm sweep under
dist-tag `next`, at version `<next patch>-next.<run number>` — `0.63.1-next.42` while `main` sits
on `0.63.0`. `latest` is untouched by it. An app on the channel is on main's code **as of last
night**, with no release cut.

A fix merged during the day therefore reaches the channel the following morning. When that is too
slow, a maintainer runs the same sweep on demand: `gh workflow run release.yml -R gjsify/gjsify
--ref main -f publish_next=true`.

## Opting in

```jsonc
// package.json
{
  "dependencies": {
    "@gjsify/cli": "next",
    "@gjsify/site": "next"
  }
}
```

```sh
gjsify install
```

`install` resolves the dist-tag and **writes the exact version it resolved into the lockfile**, so
the tree is reproducible and a teammate's install matches yours. Moving to a newer `next`:

```sh
gjsify install --refresh-lockfile    # re-resolves the tag to the version it points at now
```

`gjsify upgrade` deliberately **leaves a `next` spec alone** — it rewrites version ranges, and a
dist-tag is not one, so it is skipped like a `workspace:` or `file:` spec. In particular `upgrade
--check` no longer reports the dep as inconsistent and `--align` no longer rewrites `next` to a
concrete version, which would have frozen the app on one prerelease.

For the CLI itself, installed globally:

```sh
gjsify self-update --tag next
```

`--tag` is the whole mechanism — nothing remembers a channel, so every `self-update` needs the
flag again. Because the default is still `latest`, a bare `gjsify self-update` on a `next` build
would quietly move you back to the release channel; it now prints one line saying so, and naming
`--tag next` as the way to stay, before doing it. Passing `--tag` explicitly — including `--tag
latest` — prints nothing.

## Going back to `latest`

```jsonc
{ "dependencies": { "@gjsify/cli": "^0.63.0" } }
```

```sh
gjsify install
```

That is all of it. The channel never moved `latest`, so there is nothing to undo on the registry
side.

## What to know before relying on it

|**every intra-`@gjsify` pin in a `next` tarball is EXACT.** `npm i @gjsify/cli@next` resolves an
all-`next` closure; you cannot end up with half the train on a prerelease and half on a release.
The flip side: do not pin *some* deps to `next` and others to a version range — npm will try to
satisfy both and either fail or install two copies.
|**right after a stable release, `next` is briefly BEHIND `latest`.** `0.63.1-next.99` sorts below
the `0.63.1` the release just cut. The next nightly publishes `0.63.2-next.N` and the channel is
ahead again, so the window is up to a day. This is expected, not a broken publish.
|**the native prebuilds are NOT on the channel**: `@gjsify/napi*`, `@gjsify/node-gi*`,
`@gjsify/gtk-runtime-*`, `@gjsify/node-runtime-*`, `@gjsify/gi-runtime-*` (12 packages). They need
macOS and Windows runners and ship as GitHub release assets, so they stay on `latest` and a
main-only fix inside them still waits for a release cut.
|**`next` is for development, not for shipping.** A `next` version is a point on `main`: it has
passed main's CI and nothing else — no release notes, no release assets, no cross-OS suite matrix.
Ship from `latest`.
|**nothing is ever unpublished.** Every `next` version stays on the registry as an immutable
version; only the dist-tag moves. A lockfile pinning `0.63.1-next.42` keeps installing forever.
|**a night on which `main` did not move publishes nothing**, and neither does one whose HEAD main's
own CI has not accepted, or one that would land inside a release. The job summary names which of
the three it was, so `next` pointing at yesterday's version is a readable state and not a silent
failure.

## Reporting against it

Say the exact version, not "next" — `next` means a different tree every night. `npm view
@gjsify/cli@next version` prints it, and the commit it was built from is both in the `publish-next`
job summary of the matching `Release` run and on the registry itself, as `gitHead`:

```sh
npm view @gjsify/cli@next gitHead
```

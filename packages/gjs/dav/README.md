# @gjsify/dav

CalDAV and CardDAV client over `fetch`. Pure TypeScript on top of `@gjsify/domparser`; iCalendar and vCard stay text plus ETags, so you bring your own parser.

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003)**: tested against mocked multistatus fixtures, not yet against a live server.

## Installation

```bash
gjsify install @gjsify/dav
```

## Usage

```typescript
import { DavClient, basicAuth } from '@gjsify/dav';

const dav = new DavClient({ auth: basicAuth(user, password) });

const { homeUrl } = await dav.discover('caldav', 'https://dav.example.org/');
const [calendar] = await dav.listCollections(homeUrl, 'caldav');

// Initial sync, then deltas with the stored token.
const first = await dav.sync(calendar.url, null);
const objects = await dav.getObjects(calendar.url, 'caldav', first.changed.map((o) => o.url));

// Conditional writes: 412 becomes a DavError with isPreconditionFailed.
await dav.put(url, ics, { ifNoneMatch: true });
await dav.put(url, ics2, { ifMatch: etag });
await dav.delete(url, { ifMatch: etag });
```

## Options

- `auth`: a function returning headers per request. `basicAuth(user, password)` and `bearerAuth(token | () => token)` are included, so an OAuth token can refresh between requests.
- `fetch`: injectable; defaults to the runtime's global `fetch`.

## API

`discover`, `listCollections`, `listObjects` (calendar-query / addressbook-query), `getObjects` (multiget), `sync` (RFC 6578; a 404 entry is a deletion), `put`, `delete`, plus `parseMultistatus` for custom requests.

A stale sync token makes the server answer 403/409/507 as a `DavError`; resync with `null`.

## License

MIT

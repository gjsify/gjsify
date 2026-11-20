# @gjsify/pim

Calendars and tasks behind one port. `CalendarBackend` moves iCalendar text; a driver moves it to a store. Parsing the text stays with the caller.

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003)**: new, no promise yet.

## Installation

```bash
gjsify install @gjsify/pim
```

## Drivers

| Subpath | Store | Runs on |
|---|---|---|
| `@gjsify/pim/caldav` | CalDAV over [`@gjsify/dav`](../dav) (plain `fetch`), with RFC 6578 delta reads | every runtime with `fetch` |
| `@gjsify/pim/eds` | Evolution Data Server (typelibs loaded on first use) | GJS on Linux |

The root export carries the port, the types (`CalendarInfo`, `RawItem`, `CollectionDelta`, ...), the error classes (`BackendUnavailableError`, `BackendAuthError`, `ConflictError`, ...) and `setPimTranslator` for localized error messages.

## Usage

```typescript
import { createCaldavBackend } from '@gjsify/pim/caldav';

const backend = createCaldavBackend({ url: 'https://dav.example.test/', username, password });
const [calendar] = await backend.listCalendars('event');
const items = await backend.listItems({ kind: 'event', calendar: calendar.uid });
```

`kind` is `'event'` or `'reminder'` (a task list). Writes take the etag back (`If-Match`); a stale one is a `ConflictError`.

## Scope

Calendars and tasks only. No contacts, no accounts (see [`@gjsify/system-accounts`](../system-accounts)), no recurrence expansion: a recurring item comes back as its series.

## Testing

`src/fake-dav-server.ts` is an in-process CalDAV server with ETags and sync tokens; the CalDAV suites run on Node and GJS against it. The EDS suite is GJS-only and covers result shapes and the no-session failure (`test:gjs` pins a dead session bus). Not covered: a live Evolution Data Server or a real CalDAV server.

## License

MIT

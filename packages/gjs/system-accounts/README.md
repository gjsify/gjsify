# @gjsify/system-accounts

The accounts a user already set up on their system: find them, read their mail server settings, log in without asking for a password again. The interface is the capabilities a caller needs; a driver per platform maps the system's account store onto them ([ADR 0095](../../../docs/adr/0095-system-accounts-are-asked-by-capability.md)).

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003)**: new, one driver, no promise yet.

## Installation

```bash
gjsify install @gjsify/system-accounts
```

## Usage

```typescript
import { createSystemAccounts, isUnavailable } from '@gjsify/system-accounts';

const accounts = createSystemAccounts();
if (accounts.capabilities().services.length === 0) {
    // No account store on this host: ask the user instead.
}

for (const account of await accounts.listAccounts('mail')) {
    const mail = await accounts.getMailSettings(account);
    if (isUnavailable(mail) || !mail.smtp) continue;

    const credentials = await accounts.getCredentials(account, 'smtp');
    if (credentials.kind === 'password') login(mail.smtp, credentials.secret);
    if (credentials.kind === 'oauth2') loginXoauth2(mail.smtp, credentials.token); // valid until credentials.expiresAt
}
```

| Call | Answers |
|---|---|
| `capabilities()` | what THIS host can answer: `services` it lists, `credentials` kinds it hands out. Both empty without an account store |
| `listAccounts(service?)` | `Account[]` (id, provider, identity, label, enabled services). Empty when the store cannot be reached |
| `getMailSettings(account)` | `{ sender, imap?, smtp? }`, each server as host, port, `security` (`tls` / `starttls` / `none`) and user name; or `Unavailable` |
| `getCredentials(account, purpose)` | `{ kind: 'password', secret }`, `{ kind: 'oauth2', token, expiresAt }`, or `Unavailable` |

**A missing capability is a value, never an exception.** `Unavailable` carries a `reason`: `no-account-store`, `unknown-account`, `not-supported` (the account has no mail server, no credentials) or `credentials-unavailable` (the store would not hand the secret out). The ADR's `Credentials` has two members; the third is how that rule is spelled for a call that has to return one.

**Secrets** go to the caller and nowhere else: never logged, cached or put in an error. They are read per call; an OAuth2 token carries its expiry, so ask again afterwards instead of keeping it.

## Platforms

| Platform | State |
|---|---|
| Linux, GNOME | **driver**: GNOME Online Accounts through `libgoa` (`gi://Goa?version=1.0&optional`). A host without the typelib still starts and reports empty capabilities |
| Linux without GOA, macOS, Windows | no driver; empty capabilities. Whether a platform offers a usable account store to third-party apps is **unexplored**, not ruled out |
| Android, iOS, browser | not served (`gjsify.runtimes`: only `gjs` is `native`) |

IMAP and SMTP passwords are looked up under the ids GOA keeps them under (`imap-password`, `smtp-password`); SMTP falls back to the stored IMAP password, because one login often serves both.

## Testing

`libgoa` has no constructor that takes a connection: `Goa.Client.new` dials the session bus. `src/fake-goa.ts` therefore exports the interfaces it calls (`ObjectManager`, `PasswordBased`, `OAuth2Based`, and the few bus methods a client needs) on a peer-to-peer `Gio.DBusServer` and points the session address at it, so the driver runs libgoa's own client code with no GNOME session, no real account and no keyring. Dummy secrets are compared, never printed.

- GLib caches the session connection per process. Run the suite through `test:gjs`, which starts it with a dead bus path; the fake refuses to go on if the process is already bound to a real bus, so a developer's accounts never reach a test.
- The mapping from account fields to the contract (host/port splitting, `tls`/`starttls`/`none` from the two flags and the port, which password ids to try) is pure and runs on Node too.
- Not covered: a real session bus, a real provider (the OAuth2 path has run against the fake only), and a host whose `libgoa` is genuinely missing (the empty-capabilities path is tested by passing no namespace).
- The `&optional` import costs a top-level await in the bundle that reaches it, and a `@gjsify/unit` run wedges on it (ADR 0085 clause 5). The specs therefore reach the driver (`src/goa.ts`) directly; only `createSystemAccounts` (`src/system-accounts.ts`) carries the flag.

## License

MIT

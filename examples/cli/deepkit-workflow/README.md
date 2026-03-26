# @gjsify/example-cli-deepkit-workflow

This example demonstrates the type-safe workflow/state machine system of [@deepkit/workflow](https://deepkit.io/library/workflow) running on GJS via Gjsify.

## Features

Models a Flatpak app installation pipeline (like GNOME Software) with 9 states:

```
requested → downloading → verifying → installing → installed
                 ↘             ↘            ↘
                failed        failed       failed

installed → updating → installed
    ↓
removing → removed
```

- **State transitions** — type-safe allowed transitions
- **Custom event classes** — carry domain data (app ID, checksum, error reason)
- **Event listeners** — react to state changes
- **Transition guards** — invalid transitions throw errors (can't skip verification)
- **Automatic pipeline** — `event.next()` chains the full install pipeline
- **Lifecycle management** — install, update, and uninstall flows

## Scenarios

1. **Happy path** — request → download → verify → install
2. **Network error** — download fails
3. **Invalid transition** — attempt to skip verification (throws error)
4. **One-click install** — single `apply()` triggers the full pipeline
5. **App update** — update an already installed app
6. **Uninstall** — remove an installed app

## Build & Run

```bash
yarn build
yarn start:node   # Run on Node.js
yarn start:gjs    # Run on GJS
```

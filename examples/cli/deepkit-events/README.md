# @gjsify/example-cli-deepkit-events

This example demonstrates the event-driven architecture of [@deepkit/event](https://deepkit.io/library/event) running on GJS via Gjsify.

## Features

- **Simple events** — `EventToken` with no data payload
- **Data events** — `DataEventToken<T>` carrying typed payload
- **Multiple listeners** — one event triggers many handlers
- **Listener ordering** — control execution order with priority
- **Custom event classes** — rich event objects extending `BaseEvent`
- **Propagation control** — `stopImmediatePropagation()` to short-circuit
- **Unsubscribe** — dynamically remove listeners
- **Real-world pattern** — event-driven notification system with metrics

## Build & Run

```bash
yarn build
yarn start:node   # Run on Node.js
yarn start:gjs    # Run on GJS
```

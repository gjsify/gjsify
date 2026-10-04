// Applying the system-bar appearance — the base, for a host with no system bars.
// The platform variants sit beside this file; decisions live in `system-bars.ts`.

/** Keep the bars' icon colour and backdrop in step with the colour scheme. Returns the stop. */
export function observeSystemBars(): () => void {
    return () => {};
}

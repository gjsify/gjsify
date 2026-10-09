// Writing text to the platform clipboard — the base, for a host with none (the unit tests, a
// bundle for neither): the write is refused and the core logs it. The platform variants sit beside
// this file (`.android.ts`, `.ios.ts`); the host that wraps them is `clipboard-host.ts`.

export function writePlatformText(_text: string): void {
    throw new Error('there is no platform clipboard on this host');
}

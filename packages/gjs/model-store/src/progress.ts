// Download progress in the WebML CG shape (ADR 0132 § 2): `create({ monitor })`
// hands the caller an EventTarget that fires `downloadprogress`, where `loaded`
// is a fraction of `total === 1`. The byte counts ride along so every app can
// show the same "548 MB, 40 %" without re-reading the manifest.

/** The `monitor` option of every capability's `create()` and of `install()`. */
export type CreateMonitorCallback = (monitor: EventTarget) => void;

/** `downloadprogress`: `loaded` is 0…1 as in the WebML CG APIs; `receivedBytes`/`totalBytes` are ours. */
export class DownloadProgressEvent extends Event {
    readonly loaded: number;
    readonly total = 1;
    readonly lengthComputable = true;

    constructor(
        readonly modelId: string,
        readonly receivedBytes: number,
        readonly totalBytes: number,
    ) {
        super('downloadprogress');
        this.loaded = totalBytes === 0 ? 1 : receivedBytes / totalBytes;
    }
}

/** Fans one download's progress out to every caller waiting on it. */
export class ProgressFanout {
    readonly #targets = new Set<EventTarget>();
    #lastFraction = -1;

    constructor(readonly modelId: string) {}

    add(monitor: CreateMonitorCallback | undefined): void {
        if (monitor === undefined) return;
        const target = new EventTarget();
        monitor(target);
        this.#targets.add(target);
    }

    /**
     * Fires at 0, at 1, and between them only when the fraction moved by at
     * least 0.1 % — a 548 MB download in 64 KiB chunks would otherwise fire
     * eight thousand events for a progress bar that shows a thousand states.
     */
    report(receivedBytes: number, totalBytes: number): void {
        const fraction = totalBytes === 0 ? 1 : receivedBytes / totalBytes;
        const edge = receivedBytes === 0 || receivedBytes === totalBytes;
        if (!edge && fraction - this.#lastFraction < 0.001) return;
        if (fraction === this.#lastFraction) return;
        this.#lastFraction = fraction;
        for (const target of this.#targets) {
            target.dispatchEvent(new DownloadProgressEvent(this.modelId, receivedBytes, totalBytes));
        }
    }
}

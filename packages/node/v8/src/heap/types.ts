// Shared shape for the per-platform process-memory readers.

/**
 * Process memory figures, in BYTES. A reader sets `0` for any figure the
 * platform does not expose (rather than guessing), and returns `null` from
 * `readProcessMemory()` when it can read nothing at all.
 */
export interface ProcessMemory {
    /** Virtual memory size (Linux `VmSize`, BSD `vsz`). */
    virtual: number;
    /** Resident set size (Linux `VmRSS`, BSD `rss`). */
    resident: number;
    /** Data-segment size (Linux `VmData`). */
    data: number;
    /** Peak virtual memory size (Linux `VmPeak`). */
    peak: number;
}

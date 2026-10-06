// One slot of data per buffer line that follows the lines through edits: when lines
// `[first, first + removed)` are replaced by `inserted` new ones, their slots are dropped and
// the same number of empty ones take their place. The Android span bookkeeping rides on it.

export class LineStore<T> {
    private slots: (T | undefined)[] = [];

    get(line: number): T | undefined {
        return this.slots[line];
    }

    set(line: number, value: T | undefined): void {
        while (this.slots.length <= line) this.slots.push(undefined);
        this.slots[line] = value;
    }

    /** Returns the values that were dropped, so the caller can release what they hold. */
    splice(first: number, removed: number, inserted: number): T[] {
        while (this.slots.length < first + removed) this.slots.push(undefined);
        const dropped = this.slots.splice(first, removed, ...Array.from({ length: inserted }, () => undefined));
        return dropped.filter((value): value is T => value !== undefined);
    }

    /** Empties every slot and returns the values that were held. */
    clear(): T[] {
        const dropped = this.slots.filter((value): value is T => value !== undefined);
        this.slots = [];
        return dropped;
    }
}

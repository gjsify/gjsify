// Counts consecutive presses the way GTK's `GdkEvent` click count does: a press within the double-tap
// timeout and slop of the last one is the next of the series. Android's `EditText` selects a word on
// the second press and, from API 28, a paragraph on the third, but never says which press it was.

export class MultiTap {
    private count = 0;
    private time = 0;
    private x = 0;
    private y = 0;

    constructor(
        private readonly timeout: number,
        private readonly slop: number,
    ) {}

    /** The press at `time` (ms) and `x`/`y` (px): 1 for a fresh press, 2 for a double, 3 for a triple. */
    press(time: number, x: number, y: number): number {
        const near = Math.abs(x - this.x) <= this.slop && Math.abs(y - this.y) <= this.slop;
        // A fourth press starts over: nothing past a triple has a meaning.
        this.count = this.count > 0 && this.count < 3 && time - this.time <= this.timeout && near ? this.count + 1 : 1;
        this.time = time;
        this.x = x;
        this.y = y;
        return this.count;
    }
}

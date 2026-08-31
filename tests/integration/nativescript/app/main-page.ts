import type { EventData, Page, Label } from '@nativescript/core';
import { result } from './app.js';

export function onNavigatingTo(args: EventData): void {
    const page = args.object as Page;
    const label = page.getViewById<Label>('result');

    // Poll briefly until the async smoke run lands its summary, then mirror it.
    const tick = (): void => {
        const s = result.summary;
        if (s) {
            label.text = s.failed === 0 ? `PASS ${s.passed}/${s.total}` : `FAIL ${s.failed}/${s.total}`;
            label.color = (s.failed === 0 ? '#26a269' : '#c01c28') as never;
        } else {
            setTimeout(tick, 100);
        }
    };
    tick();
}

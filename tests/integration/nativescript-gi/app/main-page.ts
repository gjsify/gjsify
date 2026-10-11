import type { EventData, Label, Page } from '@nativescript/core';
import { gobjectEngineName } from '@gjsify/adwaita-core';

import { result } from './app.js';
import { optedIn } from './opt-in.js';

export function onNavigatingTo(args: EventData): void {
    const page = args.object as Page;
    const label = page.getViewById<Label>('result');
    const engine = page.getViewById<Label>('engine');

    // Which engine, on screen: this app's whole point is that the answer is knowable from inside
    // it, and a phone in someone's hand is where that is worth something.
    engine.text = `opt-in ${optedIn ? 'on' : 'off'} · engine ${gobjectEngineName()}`;

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

// Pure helpers over the story contract — no platform dependencies.

import { ControlType, type StoryArgs, type StoryArgValue, type StoryControl } from './types.js';

/**
 * Derive the initial {@link StoryArgs} from a control list's `defaultValue`s so
 * a story spells its defaults once (in `controls`) rather than duplicating them
 * in a constructor.
 *
 * A control without an explicit `defaultValue` falls back to a kind-appropriate
 * empty value: TEXT → `''`, COLOR → `'#000000'`, BOOLEAN → `false`,
 * NUMBER/RANGE → `min ?? 0`, SELECT → first option's value (or `null`).
 */
export function argsFromControls(controls: StoryControl[] = []): StoryArgs {
    const args: StoryArgs = {};
    for (const control of controls) {
        args[control.name] = defaultFor(control);
    }
    return args;
}

function defaultFor(control: StoryControl): StoryArgValue {
    if (control.defaultValue !== undefined) {
        return control.defaultValue;
    }
    switch (control.type) {
        case ControlType.TEXT:
            return '';
        case ControlType.COLOR:
            return '#000000';
        case ControlType.BOOLEAN:
            return false;
        case ControlType.NUMBER:
        case ControlType.RANGE:
            return control.min ?? 0;
        case ControlType.SELECT:
            return control.options[0]?.value ?? null;
        default:
            return null;
    }
}

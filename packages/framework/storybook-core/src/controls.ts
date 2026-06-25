// bindControl — renderer-agnostic control-row binding.
//
// Original implementation, extracting ALL the per-kind value coercion that
// today lives duplicated in each renderer's control-row builders:
//   - @gjsify/storybook            StorybookWindow._createControlRow family
//     (_createTextRow / _createNumberRow / _createBooleanRow / _createRangeRow /
//      _createSelectRow / _createColorRow + _writeArg + _formatRangeValue)
//   - @gjsify/adwaita-storybook    controls.ts createControlRow + textRow/…/colorRow
//   - @gjsify/storybook-nativescript  controls.ts createControlRow + textRow/…/colorRow
//
// The shared coercion logic — initial-value seeding, SELECT index↔value mapping
// (+ the empty-options guard returning null), RANGE-vs-NUMBER formatting
// (`asInteger ? round : parseFloat`-shaped rounding) and the value-type guards —
// is identical in all three; only the WIDGET differs. So a renderer now supplies
// a {@link ControlWidgetFactory} producing leaf {@link ControlWidget}s, and
// `bindControl` owns the wiring + coercion.

import {
    ControlType,
    type StoryArgs,
    type StoryArgValue,
    type StoryControl,
    type StoryNumberControl,
    type StorySelectControl,
} from '@gjsify/stories';

/** A built control: the row's view node plus a refresher that re-syncs it from args. */
export interface ControlRow<TNode> {
    /** The node appended into the controls panel. */
    view: TNode;
    /** Re-sync the widget from the story's current args (called on every args change). */
    refresh: (args: StoryArgs) => void;
}

/**
 * A leaf control widget the renderer builds. `bindControl` reads/writes its
 * decoded value and subscribes to its change event — it knows nothing about the
 * story args.
 *
 * @typeParam TNode the renderer's view-node type.
 * @typeParam V     the widget's native value type (`string`, `boolean`,
 *                  `number`; SELECT is index-valued).
 */
export interface ControlWidget<TNode, V> {
    /** The widget's view node. */
    node: TNode;
    /** Read the widget's current value. */
    get(): V;
    /** Write the widget's value (without firing its change callback when avoidable). */
    set(value: V): void;
    /** Subscribe to user-driven value changes. */
    onChange(cb: (value: V) => void): void;
}

/**
 * Builds the leaf widget for each {@link ControlType}. The single
 * renderer-specific seam: GTK builds Adwaita rows, the browser builds
 * `adw-*` custom elements, NativeScript builds native Adwaita views.
 *
 * `select` is index-valued (the widget exposes the selected option index, not
 * its value — `bindControl` maps index↔value). `number`/`range` receive the
 * full {@link StoryNumberControl} so the widget can set min/max/step.
 */
export interface ControlWidgetFactory<TNode> {
    text(label: string, desc: string | undefined): ControlWidget<TNode, string>;
    boolean(label: string, desc: string | undefined): ControlWidget<TNode, boolean>;
    number(control: StoryNumberControl): ControlWidget<TNode, number>;
    range(control: StoryNumberControl): ControlWidget<TNode, number>;
    /** Index-valued: the widget's value is the selected option's index. */
    select(control: StorySelectControl): ControlWidget<TNode, number>;
    color(label: string, desc: string | undefined): ControlWidget<TNode, string>;
}

/** The story surface `bindControl` drives — the args bag + the single-arg writer. */
export interface BindableStory {
    readonly args: StoryArgs;
    setArg(name: string, value: StoryArgValue): void;
}

/** A control's display label — explicit `label` else its `name`. */
function controlLabel(control: StoryControl): string {
    return control.label || control.name;
}

/**
 * Build + wire a single control row, or `null` when it cannot be rendered (an
 * unsupported type, or a SELECT with no options).
 *
 * The widget's change callback writes the decoded value back through
 * `story.setArg`; the returned `refresh` re-reads the arg and pushes it into the
 * widget only when it differs (mirrors every renderer's `if (get() !== next)`
 * guard, so a programmatic args change doesn't re-fire the widget's own event).
 */
export function bindControl<TNode>(
    story: BindableStory,
    control: StoryControl,
    factory: ControlWidgetFactory<TNode>,
): ControlRow<TNode> | null {
    const name = control.name;
    const desc = control.description;

    switch (control.type) {
        case ControlType.TEXT: {
            const widget = factory.text(controlLabel(control), desc);
            const current = story.args[name];
            widget.set(typeof current === 'string' ? current : '');
            widget.onChange((value) => story.setArg(name, value));
            return {
                view: widget.node,
                refresh: (args) => {
                    const next = typeof args[name] === 'string' ? (args[name] as string) : '';
                    if (widget.get() !== next) widget.set(next);
                },
            };
        }

        case ControlType.COLOR: {
            const widget = factory.color(controlLabel(control), desc);
            const current = story.args[name];
            widget.set(typeof current === 'string' ? current : '#000000');
            widget.onChange((value) => story.setArg(name, value));
            return {
                view: widget.node,
                refresh: (args) => {
                    const next = typeof args[name] === 'string' ? (args[name] as string) : '#000000';
                    if (widget.get() !== next) widget.set(next);
                },
            };
        }

        case ControlType.BOOLEAN: {
            const widget = factory.boolean(controlLabel(control), desc);
            widget.set(Boolean(story.args[name]));
            widget.onChange((value) => story.setArg(name, value));
            return {
                view: widget.node,
                refresh: (args) => {
                    const next = Boolean(args[name]);
                    if (widget.get() !== next) widget.set(next);
                },
            };
        }

        case ControlType.NUMBER: {
            const widget = factory.number(control);
            const current = story.args[name];
            widget.set(typeof current === 'number' ? current : (control.min ?? 0));
            widget.onChange((value) => story.setArg(name, value));
            return {
                view: widget.node,
                refresh: (args) => {
                    const next = typeof args[name] === 'number' ? (args[name] as number) : 0;
                    if (widget.get() !== next) widget.set(next);
                },
            };
        }

        case ControlType.RANGE: {
            const widget = factory.range(control);
            const current = story.args[name];
            const initial = typeof current === 'number' ? current : (control.min ?? 0);
            widget.set(initial);
            widget.onChange((value) => story.setArg(name, value));
            return {
                view: widget.node,
                refresh: (args) => {
                    const next = typeof args[name] === 'number' ? (args[name] as number) : initial;
                    if (widget.get() !== next) widget.set(next);
                },
            };
        }

        case ControlType.SELECT: {
            const options = control.options;
            if (!options?.length) {
                console.warn(`SELECT control "${name}" has no options`);
                return null;
            }
            const widget = factory.select(control);
            const current = story.args[name];
            // Seed: the first matching option's index, clamped to 0 (the GTK
            // renderer only set it when `>= 0`; the browser/NS clamp to 0 — the
            // clamp is the superset behaviour, so a non-matching default lands on
            // the first option rather than leaving the widget unset).
            const initialIdx = Math.max(
                0,
                options.findIndex((opt) => opt.value === current),
            );
            widget.set(initialIdx);
            widget.onChange((idx) => {
                if (idx >= 0 && idx < options.length) story.setArg(name, options[idx].value);
            });
            return {
                view: widget.node,
                refresh: (args) => {
                    const value = args[name];
                    const idx = options.findIndex((opt) => opt.value === value);
                    if (idx >= 0 && widget.get() !== idx) widget.set(idx);
                },
            };
        }

        default:
            console.warn(`Unsupported control type: ${(control as StoryControl).type}`);
            return null;
    }
}

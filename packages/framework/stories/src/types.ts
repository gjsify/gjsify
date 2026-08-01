// Runtime-agnostic story-authoring contract for gjsify storybook renderers.
// original implementation — ZERO platform imports, so the GTK renderer
// (@gjsify/storybook) and any future web / nativescript renderer share one
// vocabulary of controls, args and metadata.

/**
 * Value type for a single story argument — covers every {@link ControlType}.
 * `null` represents "not set".
 */
export type StoryArgValue = string | number | boolean | null;

/** Map of story-argument name → current value. */
export type StoryArgs = Record<string, StoryArgValue>;

/** Control kinds a story can expose for live editing in the runner. */
export enum ControlType {
    TEXT = 'text',
    NUMBER = 'number',
    BOOLEAN = 'boolean',
    SELECT = 'select',
    RANGE = 'range',
    COLOR = 'color',
}

/** A single choice in a {@link ControlType.SELECT} control. */
export interface StorySelectOption {
    label: string;
    value: StoryArgValue;
}

interface StoryControlBase {
    /** Argument key this control drives (matches a key in {@link StoryArgs}). */
    name: string;
    /** Human-readable label shown beside the control. */
    label: string;
    /** Optional help / tooltip text. */
    description?: string;
}

/** Free-text control. */
export interface StoryTextControl extends StoryControlBase {
    type: ControlType.TEXT;
    defaultValue?: string;
}

/** Color picker — `defaultValue` is a `#rrggbb` hex string. */
export interface StoryColorControl extends StoryControlBase {
    type: ControlType.COLOR;
    defaultValue?: string;
}

/** Toggle control. */
export interface StoryBooleanControl extends StoryControlBase {
    type: ControlType.BOOLEAN;
    defaultValue?: boolean;
}

/** Numeric spinner ({@link ControlType.NUMBER}) or slider ({@link ControlType.RANGE}). */
export interface StoryNumberControl extends StoryControlBase {
    type: ControlType.NUMBER | ControlType.RANGE;
    min?: number;
    max?: number;
    step?: number;
    defaultValue?: number;
}

/** Single-choice dropdown. */
export interface StorySelectControl extends StoryControlBase {
    type: ControlType.SELECT;
    options: StorySelectOption[];
    defaultValue?: StoryArgValue;
}

/**
 * A control descriptor — a discriminated union on `type` so per-kind fields are
 * compile-time-checked (`min`/`max`/`step` only on NUMBER/RANGE, `options` only
 * on SELECT).
 */
export type StoryControl =
    | StoryTextControl
    | StoryColorControl
    | StoryBooleanControl
    | StoryNumberControl
    | StorySelectControl;

/**
 * Metadata describing one story (or a group of variants of one component).
 *
 * `TComponent` defaults to `unknown` to keep this contract platform-free — the
 * GTK renderer passes a `GObject.GType`, a future web renderer might pass a tag
 * name. It is display-only.
 */
export interface StoryMeta<TComponent = unknown> {
    /** `"Category/Name"` — the slash-prefix groups the navigation sidebar. */
    title: string;
    /** What the story demonstrates. */
    description?: string;
    /** The component under test — a renderer-specific handle, display only. */
    component?: TComponent;
    /** Free-form tags (`'autodocs'` is reserved for generated docs). */
    tags?: string[];
    /** Editable controls that drive this story's {@link StoryArgs}. */
    controls?: StoryControl[];
}

/**
 * A renderer's story-widget contract: a zero-arg constructor that also exposes
 * static metadata. Each renderer specializes `TWidget` with its own base class
 * (the GTK renderer's `StoryWidget`, a future web renderer's element).
 */
export interface StoryComponentConstructor<TWidget = unknown> {
    new (): TWidget;
    getMetadata(): StoryMeta;
}

/**
 * A group of related story constructors. `instances` is populated by a renderer
 * registry once the widgets are constructed.
 */
export interface StoryModule<TWidget = unknown> {
    stories: StoryComponentConstructor<TWidget>[];
    instances?: TWidget[];
}

/**
 * Wraps a story's content-build step — e.g. to install a shared action group or
 * a mock environment around every story in a module. Runs in the renderer's
 * initialize path: call `build()` to perform the default construction.
 */
export type StoryDecorator<TWidget = unknown> = (build: () => void, widget: TWidget) => void;

/** Narrowing guard — `true` when `value` is a {@link StoryModule}. */
export function isStoryModule(value: unknown): value is StoryModule {
    return typeof value === 'object' && value !== null && Array.isArray((value as { stories?: unknown }).stories);
}

// Gamepad Web API — the W3C polling surface over a platform device source.
// Reference: https://w3c.github.io/gamepad/
//
// This file owns what the SPEC defines — `[[gamepads]]` index selection, button/axis
// state, snapshots, the connected/disconnected events. What a platform's subsystem
// speaks (libmanette's signals and kernel codes, SDL's layout) lives in a
// `GamepadSource` (`source.ts`, ADR 0075), so there is one copy of this logic however
// many backends exist.

import { loadGamepadBackend, reportGamepadBackendOnce, reportGamepadMonitorFault } from './backend.js';
import { W3C_AXIS_COUNT } from './axis-mapping.js';
import { W3C_BUTTON_COUNT } from './button-mapping.js';
import { GamepadButton } from './gamepad-button.js';
import { Gamepad } from './gamepad.js';
import { GamepadEvent } from './gamepad-event.js';
import { ManetteSource } from './manette-source.js';
import { SdlSource } from './sdl-source.js';
import type { GamepadSource, GamepadSourceDevice, GamepadSourceSink } from './source.js';

/** Internal mutable state for a single connected gamepad. */
interface DeviceState {
    device: GamepadSourceDevice;
    index: number;
    connected: boolean;
    timestamp: number;
    buttons: Float64Array;
    buttonsPressed: boolean[];
    axes: Float64Array;
}

export interface GamepadManagerOptions {
    /**
     * Drive this source instead of probing the host's backend. For tests — it is how the
     * manager is exercised with no controller and no typelib — and for an embedder that
     * already owns an input stack.
     */
    source?: GamepadSource;
}

/**
 * The W3C polling model over a {@link GamepadSource}: the source reports changes as they
 * happen, this caches the latest state, and `getGamepads()` returns a snapshot.
 */
export class GamepadManager {
    /**
     * The spec's `Navigator.[[gamepads]]` — an EMPTY list until something
     * connects, then one entry per index ever handed out, `null` where the slot
     * is free. Never pre-filled: see the note on {@link getGamepads}.
     */
    private _slots: (DeviceState | null)[] = [];
    private readonly _injectedSource: GamepadSource | null;
    private _source: GamepadSource | null = null;
    /** Whether `_source.start()` RETURNED — a source whose start threw is never polled. */
    private _started = false;
    private _initPromise: Promise<void> | null = null;
    private _initialized = false;

    /** The one sink every source reports through. */
    private readonly _sink: GamepadSourceSink = {
        connected: (device) => this._onDeviceConnected(device),
        disconnected: (device) => this._onDeviceDisconnected(device),
        button: (device, index, value, pressed) => this._onButton(device, index, value, pressed),
        axis: (device, index, value) => this._onAxis(device, index, value),
    };

    constructor(options: GamepadManagerOptions = {}) {
        this._injectedSource = options.source ?? null;
    }

    /** Lazily start the device source, on the first `getGamepads()`. */
    private _ensureInit(): void {
        if (this._initialized) return;
        if (this._initPromise) return;

        // `_init()` is deliberately NOT awaited — `getGamepads()` is synchronous per the
        // W3C polling contract — so a rejection here would be an UNHANDLED rejection:
        // unattributable on GJS and a process kill under Node's default
        // `--unhandled-rejections=throw`. Only `source.start()` can throw here, because
        // the probe returns a classified result instead of rejecting — hence a monitor
        // fault, not a failed load.
        this._initPromise = this._init().catch((error: unknown) => {
            reportGamepadMonitorFault(error, this._source);
            // Mark done rather than leaving `_initialized` false with a live
            // `_initPromise`: the retry gate would block re-entry anyway, so say so
            // explicitly instead of relying on that side effect.
            this._initialized = true;
        });
    }

    private async _init(): Promise<void> {
        let source = this._injectedSource;
        if (source === null) {
            const backend = await loadGamepadBackend();
            // The USE site says it, once per process — the capability query stays
            // silent (see the header of `backend.ts`).
            reportGamepadBackendOnce(backend);
            if (backend.status === 'sdl') {
                source = new SdlSource(backend.module);
            } else if (backend.status === 'manette') {
                source = new ManetteSource(backend.module);
            } else {
                // No usable backend here. `getGamepads()` keeps answering the W3C
                // shape (see its doc for why that is correct rather than a silent
                // failure) and `hasGamepadBackend()` is the machine-readable form of
                // the same fact.
                this._initialized = true;
                return;
            }
        }
        // Assigned BEFORE start(): a start that throws half-way may already hold
        // native handles, and dispose() releases them through this field.
        this._source = source;
        source.start(this._sink);
        this._started = true;
        this._initialized = true;
    }

    private _onDeviceConnected(device: GamepadSourceDevice): void {
        if (this._findState(device)) return;
        // "Select an unused gamepad index for gamepad" (W3C Gamepad,
        // § Selecting an unused gamepad index): the first `null` slot, and
        // otherwise APPEND. There is no upper bound in the algorithm, so there is
        // none here either — a fixed cap would silently drop the 5th controller.
        let slotIndex = this._slots.indexOf(null);
        if (slotIndex === -1) {
            slotIndex = this._slots.length;
            this._slots.push(null);
        }

        const state: DeviceState = {
            device,
            index: slotIndex,
            connected: true,
            timestamp: performance.now(),
            buttons: new Float64Array(W3C_BUTTON_COUNT),
            buttonsPressed: Array.from<boolean>({ length: W3C_BUTTON_COUNT }).fill(false),
            axes: new Float64Array(W3C_AXIS_COUNT),
        };
        this._slots[slotIndex] = state;

        globalThis.dispatchEvent?.(
            new GamepadEvent('gamepadconnected', { gamepad: this._createSnapshot(state) }) as unknown as Event,
        );
    }

    private _onDeviceDisconnected(device: GamepadSourceDevice): void {
        const state = this._findState(device);
        if (!state) return;

        state.connected = false;
        const snapshot = this._createSnapshot(state);
        this._slots[state.index] = null;

        globalThis.dispatchEvent?.(new GamepadEvent('gamepaddisconnected', { gamepad: snapshot }) as unknown as Event);
    }

    private _onButton(device: GamepadSourceDevice, index: number, value: number, pressed: boolean): void {
        const state = this._findState(device);
        if (!state || !Number.isInteger(index) || index < 0 || index >= W3C_BUTTON_COUNT) return;
        state.buttons[index] = value;
        state.buttonsPressed[index] = pressed;
        state.timestamp = performance.now();
    }

    private _onAxis(device: GamepadSourceDevice, index: number, value: number): void {
        const state = this._findState(device);
        if (!state || !Number.isInteger(index) || index < 0 || index >= W3C_AXIS_COUNT) return;
        state.axes[index] = value;
        state.timestamp = performance.now();
    }

    private _findState(device: GamepadSourceDevice): DeviceState | null {
        for (const state of this._slots) {
            if (state && state.device === device) return state;
        }
        return null;
    }

    private _createSnapshot(state: DeviceState): Gamepad {
        const buttons: GamepadButton[] = [];
        for (let i = 0; i < W3C_BUTTON_COUNT; i++) {
            buttons.push(
                new GamepadButton(
                    state.buttonsPressed[i],
                    state.buttonsPressed[i] || state.buttons[i] > 0,
                    state.buttons[i],
                ),
            );
        }

        return new Gamepad({
            id: state.device.id,
            index: state.index,
            connected: state.connected,
            timestamp: state.timestamp,
            // Every source maps to the standard layout before it reaches the sink
            // (see `source.ts`), so this is a property of the contract, not a guess.
            mapping: 'standard',
            axes: Array.from(state.axes),
            buttons,
            vibrationActuator: state.device.vibrationActuator,
        });
    }

    /**
     * Returns a snapshot list matching the W3C `navigator.getGamepads()`
     * contract. Each non-null entry is a frozen Gamepad object with current
     * state.
     *
     * ## The list is EMPTY until something connects — not four nulls
     *
     * `Navigator.[[gamepads]]` "is initially the empty list" and grows only when
     * an index is selected for a connected gamepad (W3C Gamepad, § Extensions to
     * the `Navigator` Interface + § Selecting an unused gamepad index); step 6 of
     * `getGamepads()` starts from an empty list and step 7 copies `[[gamepads]]`
     * into it. So on a host where nothing has ever connected the conformant answer
     * is `[]`, and that is what this returns.
     *
     * The pre-filled four-slot array this used to return is CHROME's shape, not
     * the spec's, and the difference is measured rather than assumed — same page
     * (`about:blank`), same machine, no controller attached:
     *
     *     firefox  → {"length":0,"json":"[]"}
     *     chromium → {"length":4,"json":"[null,null,null,null]"}
     *
     * WebKit agrees with Firefox by construction:
     * `NavigatorGamepad::gamepads()` does `if (m_gamepads.isEmpty()) return
     * m_gamepads;` (`Source/WebCore/Modules/gamepad/NavigatorGamepad.cpp`).
     * Hard-coding four made `getGamepads().length` report four non-existent ports.
     *
     * ## On a host with NO gamepad backend it stays a list — do NOT make it throw
     *
     * The W3C Gamepad API has no state for "this platform has no gamepad
     * subsystem". `getGamepads()`'s steps only ever *return a list*; the single
     * `throw` in them is a `SecurityError` for the `"gamepad"` permission policy,
     * and every other negative case — no `Document`, no user gesture, nothing
     * connected — is spelled "return an empty list". A real browser on a machine
     * with no gamepad driver does exactly that, structurally: WebKit compiles an
     * `EmptyGamepadProvider` (`Source/WebCore/platform/gamepad/`) whose
     * `platformGamepads()` returns a static empty vector on every port with no
     * backend.
     *
     * So throwing here would be LESS conformant, not more: it would break every
     * page that does `navigator.getGamepads().length`, which is the canonical
     * poll. The reason behind an empty answer is exposed NEXT TO the conformant
     * surface instead — `hasGamepadBackend()` (exported from the package root)
     * plus the one-time diagnostic this manager emits on its first init.
     */
    getGamepads(): (Gamepad | null)[] {
        this._ensureInit();
        // A pull backend refreshes at the W3C polling moment; a push backend has
        // already delivered everything through the sink.
        if (this._started) this._source?.poll?.();

        return this._slots.map((state) => (state ? this._createSnapshot(state) : null));
    }

    /** Stop the source and drop every index. */
    dispose(): void {
        this._source?.stop();
        this._source = null;
        this._started = false;
        // Drop every index too, not just its contents: `[[gamepads]]` is back to
        // the empty list a fresh manager starts from.
        this._slots.length = 0;

        this._initialized = false;
        this._initPromise = null;
    }
}

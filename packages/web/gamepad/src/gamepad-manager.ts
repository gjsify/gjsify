// Gamepad Web API — GamepadManager
// Bridges libmanette's event-driven model to the W3C polling-based Gamepad API.
// Reference: https://w3c.github.io/gamepad/
// Reimplemented for GJS using libmanette (gi://Manette)

import type Manette from '@girs/manette-0.2';
import { loadGamepadBackend, reportGamepadBackendOnce, reportGamepadMonitorFault } from './backend.js';
import { GamepadButton } from './gamepad-button.js';
import { Gamepad } from './gamepad.js';
import { GamepadEvent } from './gamepad-event.js';
import { ManetteHapticActuator } from './haptic-actuator.js';
import { MANETTE_TO_W3C_BUTTON, W3C_BUTTON_COUNT } from './button-mapping.js';
import { MANETTE_TO_W3C_AXIS, ManetteAxis, W3C_AXIS_COUNT, TRIGGER_PRESS_THRESHOLD } from './axis-mapping.js';
import { W3CButton } from './button-mapping.js';

/** Internal mutable state for a single connected gamepad. */
interface DeviceState {
    device: Manette.Device;
    index: number;
    connected: boolean;
    timestamp: number;
    buttons: Float64Array;
    buttonsPressed: boolean[];
    axes: Float64Array;
    hapticActuator: ManetteHapticActuator;
    signalIds: number[];
}

/**
 * Singleton manager that wraps Manette.Monitor and maintains gamepad state.
 *
 * libmanette fires GObject signals on button/axis changes. This manager
 * caches the latest state so that `getGamepads()` can return a snapshot
 * matching the W3C Gamepad API's polling model.
 */
export class GamepadManager {
    private _monitor: Manette.Monitor | null = null;
    /**
     * The spec's `Navigator.[[gamepads]]` — an EMPTY list until something
     * connects, then one entry per index ever handed out, `null` where the slot
     * is free. Never pre-filled: see the note on {@link getGamepads}.
     */
    private _slots: (DeviceState | null)[] = [];
    private _monitorSignalIds: number[] = [];
    private _ManetteModule: typeof Manette | null = null;
    private _initPromise: Promise<void> | null = null;
    private _initialized = false;

    /**
     * Lazily initialize the Manette.Monitor.
     * Called on first `getGamepads()` invocation.
     */
    private _ensureInit(): void {
        if (this._initialized) return;
        if (this._initPromise) return;

        // `_init()` is deliberately NOT awaited — `getGamepads()` is synchronous
        // per the W3C polling contract — so a rejection here would surface as an
        // UNHANDLED rejection: unattributable on GJS and, under Node's default
        // `--unhandled-rejections=throw`, a process kill. Everything past the
        // backend probe (`new Monitor()`, `iterate()`, `connect()`) can throw a
        // GError, and before this handler existed each one was a permanently
        // silent "no gamepads" plus an unhandled rejection. Only THAT class of
        // failure reaches here — the probe never rejects, it returns a classified
        // result — so this is reported as a monitor fault, not as a failed load.
        this._initPromise = this._init().catch((error: unknown) => {
            reportGamepadMonitorFault(error);
            // Mark done rather than leaving `_initialized` false with a live
            // `_initPromise`: the retry gate would block re-entry anyway, so say
            // so explicitly instead of relying on that side effect.
            this._initialized = true;
        });
    }

    private async _init(): Promise<void> {
        const backend = await loadGamepadBackend();
        // The USE site is what says it, once per process — the capability query
        // stays silent (see the header of `backend.ts`). This is the operation
        // that wanted a monitor, so this is where "there is no backend" or
        // "the backend is broken" is worth a line.
        reportGamepadBackendOnce(backend);
        if (backend.module === null) {
            // No usable backend on this host. `getGamepads()` keeps answering
            // the W3C shape (see its doc comment for why that is correct, not a
            // silent failure), and `hasGamepadBackend()` is the machine-readable
            // form of the same fact.
            this._initialized = true;
            return;
        }
        this._ManetteModule = backend.module;

        const monitor = new this._ManetteModule.Monitor();
        this._monitor = monitor;

        // Enumerate already-connected devices
        const iter = monitor.iterate();
        let result = iter.next();
        while (result[0]) {
            const device = result[1];
            if (device) {
                this._onDeviceConnected(device);
            }
            result = iter.next();
        }

        // Listen for future connect/disconnect
        this._monitorSignalIds.push(
            monitor.connect('device-connected', (_monitor: Manette.Monitor, device: Manette.Device) => {
                this._onDeviceConnected(device);
            }),
            monitor.connect('device-disconnected', (_monitor: Manette.Monitor, device: Manette.Device) => {
                this._onDeviceDisconnected(device);
            }),
        );

        this._initialized = true;
    }

    private _onDeviceConnected(device: Manette.Device): void {
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
            hapticActuator: new ManetteHapticActuator(device),
            signalIds: [],
        };

        // Wire up device signals
        state.signalIds.push(
            device.connect('button-press-event', (_device: Manette.Device, event: Manette.Event) => {
                this._onButtonPress(state, event);
            }),
            device.connect('button-release-event', (_device: Manette.Device, event: Manette.Event) => {
                this._onButtonRelease(state, event);
            }),
            device.connect('absolute-axis-event', (_device: Manette.Device, event: Manette.Event) => {
                this._onAxisChange(state, event);
            }),
            device.connect('hat-axis-event', (_device: Manette.Device, event: Manette.Event) => {
                this._onHatChange(state, event);
            }),
            device.connect('disconnected', () => {
                this._onDeviceDisconnected(device);
            }),
        );

        this._slots[slotIndex] = state;

        // Dispatch gamepadconnected event
        const snapshot = this._createSnapshot(state);
        if (snapshot) {
            globalThis.dispatchEvent?.(new GamepadEvent('gamepadconnected', { gamepad: snapshot }) as unknown as Event);
        }
    }

    private _onDeviceDisconnected(device: Manette.Device): void {
        const state = this._findStateByDevice(device);
        if (!state) return;

        // Disconnect all device signals
        for (const id of state.signalIds) {
            device.disconnect(id);
        }

        state.connected = false;
        const snapshot = this._createSnapshot(state);
        this._slots[state.index] = null;

        // Dispatch gamepaddisconnected event
        if (snapshot) {
            globalThis.dispatchEvent?.(
                new GamepadEvent('gamepaddisconnected', { gamepad: snapshot }) as unknown as Event,
            );
        }
    }

    private _onButtonPress(state: DeviceState, event: Manette.Event): void {
        const [ok, button] = event.get_button();
        if (!ok) return;

        const w3cIdx = MANETTE_TO_W3C_BUTTON.get(button);
        if (w3cIdx === undefined) return;

        state.buttons[w3cIdx] = 1.0;
        state.buttonsPressed[w3cIdx] = true;
        state.timestamp = performance.now();
    }

    private _onButtonRelease(state: DeviceState, event: Manette.Event): void {
        const [ok, button] = event.get_button();
        if (!ok) return;

        const w3cIdx = MANETTE_TO_W3C_BUTTON.get(button);
        if (w3cIdx === undefined) return;

        state.buttons[w3cIdx] = 0.0;
        state.buttonsPressed[w3cIdx] = false;
        state.timestamp = performance.now();
    }

    private _onAxisChange(state: DeviceState, event: Manette.Event): void {
        const [ok, axis, value] = event.get_absolute();
        if (!ok) return;

        const w3cAxisIdx = MANETTE_TO_W3C_AXIS.get(axis);
        if (w3cAxisIdx !== undefined) {
            // Stick axis → axes array
            state.axes[w3cAxisIdx] = value;
        } else if (axis === ManetteAxis.LEFT_TRIGGER) {
            // Left trigger (SDL idx 4) → buttons[6] with analog value
            const normalized = (value + 1) / 2; // libmanette: -1..1 → 0..1
            state.buttons[W3CButton.LEFT_TRIGGER] = normalized;
            state.buttonsPressed[W3CButton.LEFT_TRIGGER] = normalized > TRIGGER_PRESS_THRESHOLD;
        } else if (axis === ManetteAxis.RIGHT_TRIGGER) {
            // Right trigger (SDL idx 5) → buttons[7] with analog value
            const normalized = (value + 1) / 2;
            state.buttons[W3CButton.RIGHT_TRIGGER] = normalized;
            state.buttonsPressed[W3CButton.RIGHT_TRIGGER] = normalized > TRIGGER_PRESS_THRESHOLD;
        }

        state.timestamp = performance.now();
    }

    private _onHatChange(state: DeviceState, event: Manette.Event): void {
        const [ok, hatAxis, hatValue] = event.get_hat();
        if (!ok) return;

        // Hat axes: 0 = horizontal (left/right), 1 = vertical (up/down)
        // Values: -1, 0, 1
        if (hatAxis === 0) {
            // Horizontal: negative = left, positive = right
            state.buttonsPressed[W3CButton.DPAD_LEFT] = hatValue < 0;
            state.buttons[W3CButton.DPAD_LEFT] = hatValue < 0 ? 1.0 : 0.0;
            state.buttonsPressed[W3CButton.DPAD_RIGHT] = hatValue > 0;
            state.buttons[W3CButton.DPAD_RIGHT] = hatValue > 0 ? 1.0 : 0.0;
        } else if (hatAxis === 1) {
            // Vertical: negative = up, positive = down
            state.buttonsPressed[W3CButton.DPAD_UP] = hatValue < 0;
            state.buttons[W3CButton.DPAD_UP] = hatValue < 0 ? 1.0 : 0.0;
            state.buttonsPressed[W3CButton.DPAD_DOWN] = hatValue > 0;
            state.buttons[W3CButton.DPAD_DOWN] = hatValue > 0 ? 1.0 : 0.0;
        }

        state.timestamp = performance.now();
    }

    private _findStateByDevice(device: Manette.Device): DeviceState | null {
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
            id: state.device.get_name() ?? `Gamepad (${state.device.get_guid()})`,
            index: state.index,
            connected: state.connected,
            timestamp: state.timestamp,
            mapping: 'standard',
            axes: Array.from(state.axes),
            buttons,
            vibrationActuator: state.hapticActuator,
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

        return this._slots.map((state) => (state ? this._createSnapshot(state) : null));
    }

    /** Cleanup — disconnect all signal handlers. */
    dispose(): void {
        for (const state of this._slots) {
            if (state) {
                for (const id of state.signalIds) {
                    state.device.disconnect(id);
                }
            }
        }
        // Drop every index too, not just its contents: `[[gamepads]]` is back to
        // the empty list a fresh manager starts from.
        this._slots.length = 0;

        if (this._monitor) {
            for (const id of this._monitorSignalIds) {
                this._monitor.disconnect(id);
            }
            this._monitorSignalIds = [];
            this._monitor = null;
        }

        this._initialized = false;
        this._initPromise = null;
    }
}

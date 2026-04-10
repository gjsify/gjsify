// Gamepad Web API — GamepadManager
// Bridges libmanette's event-driven model to the W3C polling-based Gamepad API.
// Reference: https://w3c.github.io/gamepad/
// Reimplemented for GJS using libmanette (gi://Manette)

import type Manette from '@girs/manette-0.2';
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

const MAX_GAMEPADS = 4;

/**
 * Singleton manager that wraps Manette.Monitor and maintains gamepad state.
 *
 * libmanette fires GObject signals on button/axis changes. This manager
 * caches the latest state so that `getGamepads()` can return a snapshot
 * matching the W3C Gamepad API's polling model.
 */
export class GamepadManager {
    private _monitor: Manette.Monitor | null = null;
    private _slots: (DeviceState | null)[] = new Array(MAX_GAMEPADS).fill(null);
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

        this._initPromise = this._init();
    }

    private async _init(): Promise<void> {
        try {
            const mod = await import('gi://Manette');
            this._ManetteModule = mod.default;
        } catch {
            // libmanette not available — getGamepads() will return empty array
            this._initialized = true;
            return;
        }

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
        // Find a free slot
        let slotIndex = -1;
        for (let i = 0; i < MAX_GAMEPADS; i++) {
            if (this._slots[i] === null) {
                slotIndex = i;
                break;
            }
        }
        if (slotIndex === -1) return; // All slots occupied

        const state: DeviceState = {
            device,
            index: slotIndex,
            connected: true,
            timestamp: performance.now(),
            buttons: new Float64Array(W3C_BUTTON_COUNT),
            buttonsPressed: new Array(W3C_BUTTON_COUNT).fill(false),
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
            globalThis.dispatchEvent?.(new GamepadEvent('gamepaddisconnected', { gamepad: snapshot }) as unknown as Event);
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
            // Left trigger → buttons[6] with analog value
            const normalized = (value + 1) / 2; // libmanette: -1..1 → 0..1
            state.buttons[W3CButton.LEFT_TRIGGER] = normalized;
            state.buttonsPressed[W3CButton.LEFT_TRIGGER] = normalized > TRIGGER_PRESS_THRESHOLD;
        } else if (axis === ManetteAxis.RIGHT_TRIGGER) {
            // Right trigger → buttons[7] with analog value
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
            buttons.push(new GamepadButton(
                state.buttonsPressed[i],
                state.buttonsPressed[i] || state.buttons[i] > 0,
                state.buttons[i],
            ));
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
     * Returns a snapshot array matching the W3C `navigator.getGamepads()` contract.
     * Each non-null entry is a frozen Gamepad object with current state.
     */
    getGamepads(): (Gamepad | null)[] {
        this._ensureInit();

        const result: (Gamepad | null)[] = [];
        for (let i = 0; i < MAX_GAMEPADS; i++) {
            const state = this._slots[i];
            result.push(state ? this._createSnapshot(state) : null);
        }
        return result;
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
        this._slots.fill(null);

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

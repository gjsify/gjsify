// TODO: Use Methods interface from @girs/gjs instead
/**
 * You can use the `Signals.addSignalMethods` method to apply the `Signals` convenience methods to an `Object`.
 * Generally, this is called on an object prototype, but may also be called on an object instance.
 * You can use this Interface for this object or prototype to make the methods in typescript known
 * @example
 * ```ts
 * const Signals = imports.signals;
 * 
 * // Define an interface with the same name of your class to make the methods known
 * interface Events extends SignalMethods {}
 * 
 * class Events {}
 * Signals.addSignalMethods(Events.prototype);
 * 
 * const events = new Events();
 * 
 * // Typescript will not complain here
 * events.emit("test-signal", "test argument");
 * ```
 */
export interface SignalMethods {
  /**
   * Connects a callback to a signal for an object. Pass the returned ID to
   * `disconect()` to remove the handler.
   * 
   * If `callback` returns `true`, emission will stop and no other handlers will be
   * invoked.
   * 
   * > Warning: Unlike GObject signals, `this` within a signal callback will always
   * > refer to the global object (ie. `globalThis`).
   * 
   * @param sigName A signal name
   * @param callback A callback function
   * @returns A handler ID
   */
  connect(sigName: string, callback: (self: any, ...args: any[]) => void): number;
  /**
   * Emits a signal for an object. Emission stops if a signal handler returns `true`.
   * 
   * Unlike GObject signals, it is not necessary to declare signals or define their
   * signature. Simply call `emit()` with whatever signal name you wish, with
   * whatever arguments you wish.
   * @param sigName A signal name
   * @param args Any number of arguments, of any type
   */
  emit(sigName: string, ...args: any[]): void;
  /**
   * Disconnects a handler for a signal.
   * @param id The ID of the handler to be disconnected
   */
  disconnect(id: number): void;
  /**
   * Disconnects all signal handlers for an object.
   */
  disconnectAll(): void
  /**
   * Checks if a handler ID is connected.
   * @param id The ID of the handler to be disconnected
   * @returns `true` if connected, or `false` if not
   */
  signalHandlerIsConnected(id: number): boolean;
}
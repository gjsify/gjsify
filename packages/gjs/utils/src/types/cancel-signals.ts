import type { SignalMethods } from './signal-methods.js';

export interface CancelSignals extends SignalMethods {
  connect(sigName: "close", callback: (self: SignalMethods) => void): number;
  emit(sigName: "close"): void;
}

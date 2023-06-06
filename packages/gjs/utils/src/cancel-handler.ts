import type { CancelSignals } from './types/index.js';

let nextRid = 1;
const resources: {[rid: number]: CancelSignals} = {};

export const createCancelHandler = () => {
    const rid = nextRid++;
    const cancelHandler = {} as CancelSignals;
    imports.signals.addSignalMethods(cancelHandler);

    resources[rid] = cancelHandler;

    return rid;
}

export const closeCancelHandler = (rid: number) => {
    const cancelHandler = getCancelHandler(rid);
    cancelHandler?.emit('close');
    delete resources[rid];
}
  
export const getCancelHandler = (rid: number): CancelSignals | undefined => {
    return resources[rid];
}
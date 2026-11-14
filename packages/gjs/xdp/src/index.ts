export { Portal, BackgroundFlags, XdpGtk4 } from './portal.js';
export {
    probeBackgroundPortal,
    requestBackground,
    setBackgroundStatus,
    type BackgroundHost,
    type BackgroundPortal,
    type BackgroundRequest,
} from './background.js';
export { AUTOSTART_FLAG, wantsAutostart, outcomeOf, type BackgroundOutcome } from './wish.js';
export { refusal, subsetOf, type RefusalError } from './refusal.js';

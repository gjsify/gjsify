export {
    armStallWatchdog,
    DEFAULT_STALL_MS,
    disarmStallWatchdog,
    getStallCounters,
    isStallWatchdogArmed,
    LOG_DOMAIN,
    mark,
    resetStallCounters,
    span,
} from './watchdog.js';
export type { SpanHandle, StallCounters, StallRecord, WatchdogOptions } from './watchdog.js';
export { measureScenario, median, percentile, thresholdFromNoise } from './scenario.js';
export type { ScenarioOptions, ScenarioResult } from './scenario.js';

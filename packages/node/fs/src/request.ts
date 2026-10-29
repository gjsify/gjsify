// Keeps a pending Gio `*_async` call visible to the main loop's exit decision,
// the way libuv counts an in-flight fs request as an active request.
//
// Without it, a CLI that ran a child process and then called `fs.stat` exited
// 0 before the stat callback ran: the child's released hold found nothing else
// pending (fast-glob after `execFile`, Learn6502's translations generator).

import { trackRequest, untrackRequest } from '@gjsify/utils/main-loop';

/**
 * Count one request now and wrap its Gio completion callback so the count
 * drops after the callback has run. Pass the wrapped callback straight to the
 * `*_async` call: every Gio async call completes exactly once.
 */
export function request<A extends unknown[]>(callback: (...args: A) => void): (...args: A) => void {
    trackRequest();
    return (...args: A) => {
        try {
            callback(...args);
        } finally {
            untrackRequest();
        }
    };
}

// Keeps a pending Gio `*_async` call visible to the main loop's exit decision,
// the way libuv counts an in-flight fs request as an active request.
//
// Without it, a CLI that ran a child process and then called `fs.stat` exited
// 0 before the stat callback ran: the child's released hold found nothing else
// pending (fast-glob after `execFile`, Learn6502's translations generator).

import { trackedCallback } from '@gjsify/utils/main-loop';

/** Count one request and wrap its Gio completion callback; see `trackedCallback`. */
export const request = trackedCallback;

import { EventDispatcher, EventToken, DataEventToken, BaseEvent, DataEvent } from '@deepkit/event';

const printGjs = (globalThis as unknown as { print?: (msg: string) => void }).print;
const log: (...args: unknown[]) => void = printGjs
    ? (...args) => printGjs(args.map((a) => String(a)).join(' '))
    : console.log.bind(console);

// ---------------------------------------------------------------------------
// 1. Simple events — EventToken with no data
// ---------------------------------------------------------------------------

log('=== 1. Simple Events (no data) ===');

const onStartup = new EventToken('app.startup');
const onShutdown = new EventToken('app.shutdown');

const dispatcher = new EventDispatcher();

dispatcher.listen(onStartup, () => {
    log('  [Listener] Application started!');
});

dispatcher.listen(onShutdown, () => {
    log('  [Listener] Application shutting down...');
});

const run = async () => {
    await dispatcher.dispatch(onStartup);
    await dispatcher.dispatch(onShutdown);

    // ---------------------------------------------------------------------------
    // 2. Data events — events that carry typed payload
    // ---------------------------------------------------------------------------

    log('\n=== 2. Data Events (typed payload) ===');

    interface User {
        id: number;
        name: string;
        email: string;
    }

    const onUserCreated = new DataEventToken<User>('user.created');
    const onUserDeleted = new DataEventToken<User>('user.deleted');

    dispatcher.listen(onUserCreated, (event) => {
        log(`  [Listener] User created: ${event.data.name} (${event.data.email})`);
    });

    dispatcher.listen(onUserDeleted, (event) => {
        log(`  [Listener] User deleted: ${event.data.name} (id: ${event.data.id})`);
    });

    const alice: User = { id: 1, name: 'Alice', email: 'alice@example.com' };
    const bob: User = { id: 2, name: 'Bob', email: 'bob@example.com' };

    await dispatcher.dispatch(onUserCreated, alice);
    await dispatcher.dispatch(onUserCreated, bob);
    await dispatcher.dispatch(onUserDeleted, alice);

    // ---------------------------------------------------------------------------
    // 3. Multiple listeners — one event, many handlers
    // ---------------------------------------------------------------------------

    log('\n=== 3. Multiple Listeners ===');

    interface OrderData {
        orderId: string;
        total: number;
    }

    const onOrderPlaced = new DataEventToken<OrderData>('order.placed');

    // Logging listener
    dispatcher.listen(onOrderPlaced, (event) => {
        log(`  [Logger] Order ${event.data.orderId} placed, total: ${event.data.total}`);
    });

    // Notification listener
    dispatcher.listen(onOrderPlaced, (event) => {
        log(`  [Notifier] Sending confirmation for order ${event.data.orderId}`);
    });

    // Analytics listener
    dispatcher.listen(onOrderPlaced, (event) => {
        log(`  [Analytics] Recording revenue: ${event.data.total}`);
    });

    await dispatcher.dispatch(onOrderPlaced, { orderId: 'ORD-42', total: 99.95 });

    // ---------------------------------------------------------------------------
    // 4. Listener ordering — control execution order
    // ---------------------------------------------------------------------------

    log('\n=== 4. Listener Ordering ===');

    const onProcess = new EventToken('process');
    const dispatcher2 = new EventDispatcher();

    // Higher order = later execution. Default is 0.
    dispatcher2.listen(onProcess, () => {
        log('  [Order 100] Final cleanup');
    }, 100);

    dispatcher2.listen(onProcess, () => {
        log('  [Order -10] Pre-processing (runs first)');
    }, -10);

    dispatcher2.listen(onProcess, () => {
        log('  [Order 0] Main processing');
    }, 0);

    dispatcher2.listen(onProcess, () => {
        log('  [Order 50] Post-processing');
    }, 50);

    await dispatcher2.dispatch(onProcess);

    // ---------------------------------------------------------------------------
    // 5. Custom event classes — rich event objects
    // ---------------------------------------------------------------------------

    log('\n=== 5. Custom Event Classes ===');

    class FileChangeEvent extends BaseEvent {
        constructor(
            public readonly path: string,
            public readonly action: 'created' | 'modified' | 'deleted',
            public readonly size: number,
        ) {
            super();
        }
    }

    const onFileChange = new EventToken<FileChangeEvent>('fs.change');
    const dispatcher3 = new EventDispatcher();

    dispatcher3.listen(onFileChange, (event) => {
        log(`  [Watcher] File ${event.action}: ${event.path} (${event.size} bytes)`);
    });

    dispatcher3.listen(onFileChange, (event) => {
        if (event.action === 'deleted') {
            log(`  [Backup] Warning: ${event.path} was deleted!`);
        }
    });

    await dispatcher3.dispatch(onFileChange, new FileChangeEvent('/home/user/doc.txt', 'created', 1024));
    await dispatcher3.dispatch(onFileChange, new FileChangeEvent('/home/user/doc.txt', 'modified', 2048));
    await dispatcher3.dispatch(onFileChange, new FileChangeEvent('/home/user/doc.txt', 'deleted', 0));

    // ---------------------------------------------------------------------------
    // 6. Event propagation control — stop propagation
    // ---------------------------------------------------------------------------

    log('\n=== 6. Event Propagation Control ===');

    class RequestEvent extends BaseEvent {
        public handled = false;

        constructor(
            public readonly url: string,
            public response: string = '',
        ) {
            super();
        }
    }

    const onRequest = new EventToken<RequestEvent>('http.request');
    const dispatcher4 = new EventDispatcher();

    // First handler: catch /api/* routes
    dispatcher4.listen(onRequest, (event) => {
        if (event.url.startsWith('/api/')) {
            event.response = `API response for ${event.url}`;
            event.handled = true;
            event.stopImmediatePropagation(); // Don't call other listeners
            log(`  [API Handler] Handled: ${event.url}`);
        }
    }, -10);

    // Second handler: catch everything else
    dispatcher4.listen(onRequest, (event) => {
        if (!event.handled) {
            event.response = `Page: ${event.url}`;
            log(`  [Page Handler] Handled: ${event.url}`);
        }
    }, 0);

    // Third handler: should NOT run for /api/* routes
    dispatcher4.listen(onRequest, (event) => {
        log(`  [Logger] Request completed: ${event.url} -> ${event.response}`);
    }, 10);

    const req1 = new RequestEvent('/api/users');
    await dispatcher4.dispatch(onRequest, req1);
    log(`  Result: ${req1.response}`);

    const req2 = new RequestEvent('/about');
    await dispatcher4.dispatch(onRequest, req2);
    log(`  Result: ${req2.response}`);

    // ---------------------------------------------------------------------------
    // 7. Unsubscribe — remove listeners dynamically
    // ---------------------------------------------------------------------------

    log('\n=== 7. Unsubscribe ===');

    const onTick = new EventToken('timer.tick');
    const dispatcher5 = new EventDispatcher();

    const unsubscribe = dispatcher5.listen(onTick, () => {
        log('  [Temporary] This should only appear once');
    });

    dispatcher5.listen(onTick, () => {
        log('  [Permanent] This appears every time');
    });

    log('  First dispatch:');
    await dispatcher5.dispatch(onTick);

    unsubscribe(); // Remove the temporary listener

    log('  Second dispatch (after unsubscribe):');
    await dispatcher5.dispatch(onTick);

    // ---------------------------------------------------------------------------
    // 8. Real-world pattern: event-driven notification system
    // ---------------------------------------------------------------------------

    log('\n=== 8. Event-Driven Notification System ===');

    interface NotificationData {
        type: 'info' | 'warning' | 'error';
        message: string;
        timestamp: Date;
    }

    const onNotification = new DataEventToken<NotificationData>('notification');
    const dispatcher6 = new EventDispatcher();

    // Console handler
    dispatcher6.listen(onNotification, (event) => {
        const { type, message } = event.data;
        const prefix = type === 'error' ? 'ERROR' : type === 'warning' ? 'WARN' : 'INFO';
        log(`  [Console] [${prefix}] ${message}`);
    });

    // Metrics handler — count by type
    const metrics: Record<string, number> = { info: 0, warning: 0, error: 0 };
    dispatcher6.listen(onNotification, (event) => {
        metrics[event.data.type]++;
    });

    await dispatcher6.dispatch(onNotification, {
        type: 'info', message: 'System started', timestamp: new Date(),
    });
    await dispatcher6.dispatch(onNotification, {
        type: 'warning', message: 'Memory usage high', timestamp: new Date(),
    });
    await dispatcher6.dispatch(onNotification, {
        type: 'error', message: 'Connection lost', timestamp: new Date(),
    });
    await dispatcher6.dispatch(onNotification, {
        type: 'info', message: 'Connection restored', timestamp: new Date(),
    });

    log(`  Metrics: info=${metrics.info}, warning=${metrics.warning}, error=${metrics.error}`);

    log('\nDone! All event examples completed.');
};

run().catch(console.error);

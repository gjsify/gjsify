import '@gjsify/node-globals/register';
import { createWorkflow, WorkflowEvent } from '@deepkit/workflow';
import { EventDispatcher } from '@deepkit/event';
import { Stopwatch } from '@deepkit/stopwatch';

const printGjs = (globalThis as unknown as { print?: (msg: string) => void }).print;
const log: (...args: unknown[]) => void = printGjs
    ? (...args) => printGjs(args.map((a) => String(a)).join(' '))
    : console.log.bind(console);

// ---------------------------------------------------------------------------
// App installation workflow — models a Flatpak/GNOME Software lifecycle
// ---------------------------------------------------------------------------

log('=== App Installation Workflow (GNOME Software) ===\n');

// Custom event classes carry domain-specific data through state transitions

class AppRequestEvent extends WorkflowEvent {
    constructor(
        public readonly appId: string,
        public readonly name: string,
        public readonly version: string,
        public readonly sizeMB: number,
    ) {
        super();
    }
}

class DownloadEvent extends WorkflowEvent {
    constructor(
        public readonly source: string = 'flathub',
        public readonly ref: string = '',
    ) {
        super();
    }
}

class VerifyEvent extends WorkflowEvent {
    constructor(
        public readonly checksum: string = '',
        public readonly gpgKey: string = '',
    ) {
        super();
    }
}

class ErrorEvent extends WorkflowEvent {
    constructor(
        public readonly reason: string = '',
    ) {
        super();
    }
}

// Define the workflow: states + allowed transitions
//
//  requested → downloading → verifying → installing → installed
//                   ↘            ↘            ↘
//                  failed       failed       failed
//                                              ↓
//  installed → updating → installed
//      ↓
//  removing → removed
//
const appWorkflow = createWorkflow('app', {
    requested:   AppRequestEvent,
    downloading: DownloadEvent,
    verifying:   VerifyEvent,
    installing:  WorkflowEvent,
    installed:   WorkflowEvent,
    updating:    DownloadEvent,
    removing:    WorkflowEvent,
    removed:     WorkflowEvent,
    failed:      ErrorEvent,
}, {
    requested:   'downloading',
    downloading: ['verifying', 'failed'],
    verifying:   ['installing', 'failed'],
    installing:  ['installed', 'failed'],
    installed:   ['updating', 'removing'],
    updating:    'installed',
    removing:    'removed',
});

const run = async () => {
    // ---------------------------------------------------------------------------
    // Scenario 1: Successful installation — happy path
    // ---------------------------------------------------------------------------

    log('--- Scenario 1: Install GNOME Text Editor ---\n');

    const dispatcher1 = new EventDispatcher();
    const stopwatch = new Stopwatch();

    dispatcher1.listen(appWorkflow.onRequested, (event) => {
        log(`  [requested] ${event.name} ${event.version} (${event.sizeMB} MB)`);
        log(`    App ID: ${event.appId}`);
    });

    dispatcher1.listen(appWorkflow.onDownloading, (event) => {
        log(`  [downloading] Fetching from ${event.source}...`);
        log(`    Ref: ${event.ref}`);
    });

    dispatcher1.listen(appWorkflow.onVerifying, (event) => {
        log(`  [verifying] Checking integrity...`);
        log(`    SHA256: ${event.checksum.slice(0, 16)}...`);
        log(`    GPG: ${event.gpgKey}`);
    });

    dispatcher1.listen(appWorkflow.onInstalling, () => {
        log('  [installing] Deploying to system...');
    });

    dispatcher1.listen(appWorkflow.onInstalled, () => {
        log('  [installed] Ready to launch!');
    });

    const app1 = appWorkflow.create('requested', dispatcher1, stopwatch);

    await app1.apply('requested', new AppRequestEvent(
        'org.gnome.TextEditor', 'Text Editor', '47.2', 12,
    ));

    log(`  State: ${app1.state.get()}`);
    log(`  Can download? ${app1.can('downloading')}`);
    log(`  Can install directly? ${app1.can('installing')}`);

    await app1.apply('downloading', new DownloadEvent('flathub', 'app/org.gnome.TextEditor/x86_64/stable'));
    await app1.apply('verifying', new VerifyEvent('a1b2c3d4e5f67890abcdef1234567890', 'Flathub GPG'));
    await app1.apply('installing');
    await app1.apply('installed');

    log(`  Final state: ${app1.state.get()}`);

    // ---------------------------------------------------------------------------
    // Scenario 2: Download fails → retry
    // ---------------------------------------------------------------------------

    log('\n--- Scenario 2: Download Fails (network error) ---\n');

    const dispatcher2 = new EventDispatcher();

    dispatcher2.listen(appWorkflow.onRequested, (event) => {
        log(`  [requested] ${event.name} ${event.version}`);
    });

    dispatcher2.listen(appWorkflow.onDownloading, (event) => {
        log(`  [downloading] Fetching from ${event.source}...`);
    });

    dispatcher2.listen(appWorkflow.onFailed, (event) => {
        log(`  [failed] ${event.reason}`);
    });

    const app2 = appWorkflow.create('requested', dispatcher2, stopwatch);

    await app2.apply('requested', new AppRequestEvent(
        'org.gnome.Loupe', 'Image Viewer', '47.0', 8,
    ));
    await app2.apply('downloading', new DownloadEvent('flathub', 'app/org.gnome.Loupe/x86_64/stable'));

    log(`  Can fail? ${app2.can('failed')}`);

    await app2.apply('failed', new ErrorEvent('Network timeout: could not reach dl.flathub.org'));
    log(`  Final state: ${app2.state.get()}`);

    // ---------------------------------------------------------------------------
    // Scenario 3: Invalid transition — can't skip verification
    // ---------------------------------------------------------------------------

    log('\n--- Scenario 3: Invalid Transition ---\n');

    const dispatcher3 = new EventDispatcher();
    const app3 = appWorkflow.create('requested', dispatcher3, stopwatch);

    await app3.apply('requested', new AppRequestEvent(
        'org.gnome.Calculator', 'Calculator', '47.0', 4,
    ));

    try {
        // Try to skip download and go directly to installing
        await app3.apply('installing');
        log('  This should not be reached');
    } catch (error) {
        log(`  Blocked: ${(error as Error).message}`);
    }

    log(`  State still: ${app3.state.get()}`);

    // ---------------------------------------------------------------------------
    // Scenario 4: Automatic pipeline via event.next()
    // ---------------------------------------------------------------------------

    log('\n--- Scenario 4: Auto-Pipeline (one-click install) ---\n');

    const dispatcher4 = new EventDispatcher();

    dispatcher4.listen(appWorkflow.onRequested, (event) => {
        log(`  [requested] ${event.name} — starting pipeline...`);
        event.next('downloading', new DownloadEvent('flathub', `app/${event.appId}/x86_64/stable`));
    });

    dispatcher4.listen(appWorkflow.onDownloading, (event) => {
        log(`  [downloading] ${event.ref}`);
        event.next('verifying', new VerifyEvent('fedcba0987654321', 'Flathub GPG'));
    });

    dispatcher4.listen(appWorkflow.onVerifying, (event) => {
        log(`  [verifying] Checksum OK`);
        event.next('installing');
    });

    dispatcher4.listen(appWorkflow.onInstalling, (event) => {
        log('  [installing] Deploying...');
        event.next('installed');
    });

    dispatcher4.listen(appWorkflow.onInstalled, () => {
        log('  [installed] Done!');
    });

    const app4 = appWorkflow.create('requested', dispatcher4, stopwatch);

    // Single apply() runs the full pipeline
    await app4.apply('requested', new AppRequestEvent(
        'org.gnome.Maps', 'Maps', '47.1', 24,
    ));

    log(`  Final state: ${app4.state.get()}`);

    // ---------------------------------------------------------------------------
    // Scenario 5: Update an installed app
    // ---------------------------------------------------------------------------

    log('\n--- Scenario 5: Update Installed App ---\n');

    const dispatcher5 = new EventDispatcher();

    dispatcher5.listen(appWorkflow.onUpdating, (event) => {
        log(`  [updating] Fetching update from ${event.source}...`);
    });

    dispatcher5.listen(appWorkflow.onInstalled, () => {
        log('  [installed] Update applied!');
    });

    // Start from "installed" state (app already on system)
    const app5 = appWorkflow.create('installed', dispatcher5, stopwatch);

    log(`  Can update? ${app5.can('updating')}`);
    log(`  Can remove? ${app5.can('removing')}`);

    await app5.apply('updating', new DownloadEvent('flathub', 'app/org.gnome.TextEditor/x86_64/stable'));
    await app5.apply('installed');

    log(`  State: ${app5.state.get()}`);

    // ---------------------------------------------------------------------------
    // Scenario 6: Uninstall
    // ---------------------------------------------------------------------------

    log('\n--- Scenario 6: Uninstall App ---\n');

    const dispatcher6 = new EventDispatcher();

    dispatcher6.listen(appWorkflow.onRemoving, () => {
        log('  [removing] Cleaning up app data...');
    });

    dispatcher6.listen(appWorkflow.onRemoved, () => {
        log('  [removed] App uninstalled.');
    });

    const app6 = appWorkflow.create('installed', dispatcher6, stopwatch);

    await app6.apply('removing');
    await app6.apply('removed');

    log(`  Final state: ${app6.state.get()}`);

    // ---------------------------------------------------------------------------
    // Transition map
    // ---------------------------------------------------------------------------

    log('\n--- Transition Map ---\n');

    const states = ['requested', 'downloading', 'verifying', 'installing',
                    'installed', 'updating', 'removing', 'removed', 'failed'] as const;

    for (const state of states) {
        const transitions = appWorkflow.getTransitionsFrom(state);
        if (transitions.length > 0) {
            log(`  ${state} → ${transitions.join(' | ')}`);
        } else {
            log(`  ${state} (terminal)`);
        }
    }

    log('\nDone!');
};

run().catch(console.error);

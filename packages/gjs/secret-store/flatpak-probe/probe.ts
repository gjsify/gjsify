// The Flatpak proof of the `portal-secret` driver (ADR 0152, step 3). Run twice in the sandbox:
//   phase A: the full contract over two namespaces, leaves one marker behind;
//   phase B (a fresh process): finds the marker, then clears it.
// All values are dummies and are compared with `===`, so a failure prints a name, never a value.

import '@gjsify/secret-store/libsecret';
import { openSecretStore, secretStoreInfo } from '@gjsify/secret-store';
import GLib from 'gi://GLib?version=2.0';
import system from 'system';

const phase = (system as { programArgs?: string[] }).programArgs?.[0] ?? 'A';
let passed = 0;
let total = 0;
function check(name: string, ok: boolean): void {
    total++;
    if (ok) passed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

async function main(): Promise<void> {
    const info = secretStoreInfo();
    console.log(`data dir: ${GLib.get_user_data_dir()}`);
    check(
        `info is portal-secret / persistent / encrypted (${info.driver})`,
        info.driver === 'portal-secret' && info.persistent && info.encryptedAtRest,
    );
    const one = await openSecretStore('probe/one');
    const two = await openSecretStore('probe/two');

    if (phase === 'A') {
        await one.clear();
        await two.clear();
        await one.set('a', 'dummy-one-a');
        await one.set('b', 'dummy-one-b');
        await two.set('a', 'dummy-two-a');
        check('get returns what set stored', (await one.get('a')) === 'dummy-one-a');
        check('same key in another namespace is separate', (await two.get('a')) === 'dummy-two-a');
        check('set replaces', (await one.set('a', 'dummy-one-a2'), (await one.get('a')) === 'dummy-one-a2'));
        check('missing key is null', (await one.get('nope')) === null);
        check('keys lists keys only, sorted', same(await one.keys(), ['a', 'b']));
        check('keys of the other namespace', same(await two.keys(), ['a']));
        await one.delete('b');
        check('delete removes the key', (await one.get('b')) === null && same(await one.keys(), ['a']));
        let threw = false;
        try {
            await one.delete('never-existed');
        } catch {
            threw = true;
        }
        check('delete of a missing key does not throw', !threw);
        await two.clear();
        check('clear empties its namespace', same(await two.keys(), []) && (await two.get('a')) === null);
        check('clear leaves the other namespace alone', (await one.get('a')) === 'dummy-one-a2');
        await one.set('marker', 'dummy-marker');
    } else {
        check('after a restart the marker is still there', (await one.get('marker')) === 'dummy-marker');
        check('after a restart the replaced value is still there', (await one.get('a')) === 'dummy-one-a2');
        check('after a restart the cleared namespace is still empty', same(await two.keys(), []));
        await one.clear();
        check('clear empties the namespace', same(await one.keys(), []));
    }
    console.log(`RESULT phase ${phase}: ${passed}/${total}`);
}

let code = 0;
try {
    await main();
} catch (error) {
    console.log(`FAIL main threw: ${(error as Error).message}`);
    code = 1;
}
if (passed !== total) code = 1;
system.exit(code);

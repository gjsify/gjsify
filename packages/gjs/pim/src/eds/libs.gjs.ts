/**
 * The EDS typelibs, loaded on first use (see optional.ts for why). `import()` of a `gi://` URL
 * is a plain dynamic import the bundler leaves alone, so a missing typelib is a rejection.
 */

import { optionalNamespace } from '../optional.js';

export const eds = optionalNamespace('EDataServer', async () => (await import('gi://EDataServer?version=1.2')).default);

/** ECal + ICalGLib, with the Promise overloads the driver uses installed. */
export const cal = optionalNamespace('ECal', async () => {
    const [{ default: Gio }, { default: ECal }, { default: ICalGLib }] = await Promise.all([
        import('gi://Gio?version=2.0'),
        import('gi://ECal?version=2.0'),
        import('gi://ICalGLib?version=3.0'),
    ]);
    // The types declare Promise overloads; make the runtime match.
    for (const method of ['get_object_list_as_comps', 'create_object'] as const) {
        Gio._promisify(ECal.Client.prototype, method, `${method}_finish`);
    }
    return { ECal, ICalGLib };
});

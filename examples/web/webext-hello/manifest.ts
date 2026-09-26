// The manifest per target. `gjsify webext` calls this once for every entry in
// `gjsify.webext.targets` and converts nothing: what differs between Manifest V2
// and V3, and between browsers, is written out here where it can be read.

interface ManifestContext {
    target: string;
    browser: 'chrome' | 'edge' | 'firefox' | 'safari';
    manifestVersion: 2 | 3;
    mode: 'production' | 'development';
    version: string;
    icons(name: string): Record<string, string>;
}

export default function manifest(ctx: ManifestContext): Record<string, unknown> {
    const mv3 = ctx.manifestVersion === 3;
    const action = {
        default_title: '__MSG_actionTitle__',
        default_popup: 'popup.html',
        default_icon: ctx.icons('icon'),
    };
    return {
        manifest_version: ctx.manifestVersion,
        name: '__MSG_extensionName__',
        description: '__MSG_extensionDescription__',
        default_locale: 'en',
        icons: ctx.icons('icon'),
        permissions: ['storage'],
        ...(mv3 ? { action } : { browser_action: action }),
        // Chromium's MV3 background is a service worker; Firefox keeps an event page with scripts.
        background:
            mv3 && ctx.browser !== 'firefox' ? { service_worker: 'background.js' } : { scripts: ['background.js'] },
        content_scripts: [{ matches: ['https://*/*'], js: ['content.js'] }],
        ...(ctx.browser === 'firefox'
            ? {
                  browser_specific_settings: {
                      gecko: {
                          id: 'webext-hello@gjsify.github.io',
                          strict_min_version: '128.0',
                          data_collection_permissions: { required: ['none'] },
                      },
                  },
              }
            : {}),
    };
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const blueprintGrammar = JSON.parse(
    readFileSync(new URL('./src/grammars/blueprint.tmLanguage.json', import.meta.url), 'utf8'),
);

export default defineConfig({
    site: 'https://gjsify.github.io',
    base: '/gjsify',
    trailingSlash: 'always',
    // Old URLs of pages that moved or were merged away. Destinations must spell
    // out the `/gjsify` base, because Astro does not prefix redirect targets
    // with `base`.
    //
    // `/widgets/*` became `/adwaita/*`: the section only ever covered Adwaita,
    // and naming it after the design system leaves room for a second one
    // (Material, say) beside it rather than under it.
    //
    // That is the same sentence this change applies a SECOND time, because its
    // premise stopped holding. The section had grown four `Gtk.*` gallery blocks,
    // and `controls.mdx` carried no Adwaita widget at all, 0 `Adw.*` against 2
    // `Gtk.*`. That is measurable per page:
    //
    //     for f in website/src/content/docs/*/[a-z]*.mdx; do
    //       printf '%-34s Adw=%s Gtk=%s\n' "$f" \
    //         "$(grep -c '<AdwWidget title="Adw\.' $f)" "$(grep -c '<AdwWidget title="Gtk\.' $f)"
    //     done
    //
    // So `Gtk` is a section BESIDE `Adwaita` rather than under it, and the split
    // follows ADR 0034 § 1, where a widget belongs to the library that owns its
    // GType, read from the GIR and never chosen per surface.
    //
    // `controls.mdx` moved whole; the two `Gtk.*` blocks on `adwaita/buttons.mdx`
    // moved to `gtk/buttons.mdx`. Only the first is a URL change, so only the
    // first needs an entry below. There is no `/widgets/controls` entry, because
    // that page was created AFTER the `/widgets/*` rename and the old URL never
    // existed. `git log --diff-filter=A -- .../adwaita/controls.mdx` is #1244
    // (2026-08-21); the rename is #1228 (2026-08-18).
    redirects: {
        // The framework pages moved out of `guides/` into their own section. They
        // shipped days earlier, so the old paths are already in the wild.
        '/guides/ui-frameworks': '/gjsify/frameworks/',
        '/frameworks/react-native-routing': '/gjsify/frameworks/react-native/',
        '/guides/solid-jsx': '/gjsify/frameworks/solid/',
        '/guides/vue-sfc': '/gjsify/frameworks/vue/',
        '/framework/bridges': '/gjsify/patterns/bridges/',
        '/patterns': '/gjsify/patterns/gobject-classes/',
        '/widgets': '/gjsify/adwaita/',
        '/widgets/boxed-lists': '/gjsify/adwaita/boxed-lists/',
        '/widgets/buttons': '/gjsify/adwaita/buttons/',
        '/widgets/layout': '/gjsify/adwaita/layout/',
        '/widgets/navigation': '/gjsify/adwaita/navigation/',
        '/widgets/view-switching': '/gjsify/adwaita/view-switching/',
        '/widgets/presentation': '/gjsify/adwaita/presentation/',
        '/widgets/feedback': '/gjsify/adwaita/feedback/',
        '/widgets/theming': '/gjsify/adwaita/theming/',
        '/adwaita/controls': '/gjsify/gtk/controls/',
    },
    vite: {
        resolve: {
            alias: {
                // Both ship exports pointing at lib/esm, which this website never builds
                // (it resolves workspace packages from src), so map them to src here.
                // Not via a `browser` → ./src export condition: that spelling broke
                // published `--app gjs` consumers and was removed for it.
                '@gjsify/stories': fileURLToPath(
                    new URL('../packages/framework/stories/src/index.ts', import.meta.url),
                ),
                '@gjsify/storybook-core': fileURLToPath(
                    new URL('../packages/framework/storybook-core/src/index.ts', import.meta.url),
                ),
            },
        },
        optimizeDeps: {
            include: [
                'three',
                'three/addons/controls/OrbitControls.js',
                'three/addons/postprocessing/EffectComposer.js',
                'three/addons/postprocessing/RenderPixelatedPass.js',
                'three/addons/postprocessing/OutputPass.js',
            ],
            exclude: [
                '@gjsify/adwaita-web',
                '@gjsify/example-dom-three-postprocessing-pixel',
                '@gjsify/example-dom-three-geometry-teapot',
                '@gjsify/example-dom-canvas2d-fireworks',
                '@gjsify/example-dom-excalibur-jelly-jumper',
                '@gjsify/example-dom-minimalist-browser',
                '@gjsify/example-dom-webrtc-loopback',
            ],
        },
    },
    integrations: [
        starlight({
            title: 'GJSify',
            description: 'The TypeScript framework for native Linux apps — on GJS, Node.js, Deno and Bun',
            // The widget gallery carries a `.blp` tab, and Shiki bundles no
            // Blueprint grammar. Scope and limits: the `_comment` header in
            // src/grammars/blueprint.tmLanguage.json.
            expressiveCode: {
                shiki: { langs: [blueprintGrammar] },
            },
            head: [
                {
                    // The @gjsify/adwaita-web skin keys its dark palette on
                    // prefers-color-scheme, overridable by .theme-dark/.theme-light,
                    // while Starlight's toggle sets data-theme. Mirroring one onto the
                    // other is what makes adw-* follow the site rather than the OS.
                    tag: 'script',
                    content:
                        "(function(){var r=document.documentElement;var s=function(){var t=r.dataset.theme;r.classList.toggle('theme-dark',t==='dark');r.classList.toggle('theme-light',t==='light');};s();new MutationObserver(s).observe(r,{attributes:true,attributeFilter:['data-theme']});})();",
                },
            ],
            components: {
                Hero: './src/components/Hero.astro',
            },
            logo: {
                light: './src/assets/logo-light.svg',
                dark: './src/assets/logo-dark.svg',
                replacesTitle: false,
            },
            favicon: '/favicon.svg',
            social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/gjsify/gjsify' }],
            // Labels stay short: a page's full story belongs in its title/description.
            //
            // Ordered for someone who wants to USE gjsify, not for someone who wants
            // to understand how it is built. Everything above `Internals` answers
            // "how do I…"; `Internals` is where the mechanism, the rationale and the
            // bridge projects live, so the pages a newcomer reads first are not
            // carrying them. `Adwaita` is named after the design system rather than
            // "Widgets" so a second one can sit beside it later instead of under it.
            // `Gtk` is that second one. ADR 0034 § 1 decides which of the two a
            // widget goes in, by the library that owns its GType. Arm 11 of
            // `scripts/check-website-adwaita-gallery.mjs` holds both halves of
            // that, a block's namespace against its section directory and a page's
            // slug against the GROUP it is listed in. The older sidebar arm reads
            // the groups as one flat set and can see neither.
            sidebar: [
                {
                    label: 'Start',
                    items: [
                        { slug: 'overview' },
                        { slug: 'getting-started' },
                        { slug: 'guides/install' },
                        { slug: 'runtimes' },
                        { slug: 'platform-support' },
                    ],
                },
                {
                    label: 'Guides',
                    items: [
                        { slug: 'guides/native-adwaita-app' },
                        { slug: 'patterns/gobject-classes' },
                        { slug: 'patterns/bridges', label: 'Bridge Widgets' },
                        { slug: 'guides/web-views' },
                        { slug: 'guides/storybook' },
                        { slug: 'guides/devtools' },
                        { slug: 'guides/vite-plugin' },
                    ],
                },
                {
                    label: 'UI Frameworks',
                    items: [
                        { slug: 'frameworks', label: 'Overview' },
                        { slug: 'frameworks/solid', label: 'Solid' },
                        { slug: 'frameworks/vue', label: 'Vue' },
                        { slug: 'frameworks/react', label: 'React' },
                        { slug: 'frameworks/react-native', label: 'React Native' },
                        { slug: 'frameworks/styling', label: 'Styling on GTK' },
                    ],
                },
                {
                    label: 'Adwaita',
                    items: [
                        { slug: 'adwaita', label: 'Gallery' },
                        { slug: 'adwaita/boxed-lists' },
                        { slug: 'adwaita/buttons' },
                        { slug: 'adwaita/layout' },
                        { slug: 'adwaita/navigation' },
                        { slug: 'adwaita/view-switching' },
                        { slug: 'adwaita/presentation' },
                        { slug: 'adwaita/feedback' },
                        { slug: 'adwaita/theming' },
                    ],
                },
                // Beside `Adwaita`, not under it. The pages here document widgets
                // whose GType belongs to GTK, which is ADR 0034 § 1's rule and the
                // one `@gjsify/gtk-host` already names its tags by.
                {
                    label: 'Gtk',
                    items: [{ slug: 'gtk', label: 'Gallery' }, { slug: 'gtk/controls' }, { slug: 'gtk/buttons' }],
                },
                {
                    label: 'Ship your app',
                    items: [
                        { slug: 'ship', label: 'Overview' },
                        { slug: 'ship/linux-packages', label: 'Linux' },
                        { slug: 'ship/macos', label: 'macOS' },
                        { slug: 'ship/windows', label: 'Windows' },
                        { slug: 'ship/signing', label: 'Signing' },
                        { slug: 'guides/flatpak-app', label: 'Flatpak: GUI App' },
                        { slug: 'guides/flatpak-cli-tool', label: 'Flatpak: CLI Tool' },
                        { slug: 'guides/distributing-gjs-apps', label: 'One-Line Installer' },
                        { slug: 'guides/self-executing-package', label: 'Self-Executing Bundle' },
                        { slug: 'guides/dlx-packaging', label: 'Run via dlx' },
                    ],
                },
                {
                    label: 'Packages',
                    items: [
                        { slug: 'packages/overview' },
                        { slug: 'packages/node', label: 'Node.js' },
                        { slug: 'packages/web', label: 'Web APIs' },
                        { slug: 'packages/dom', label: 'DOM & Graphics' },
                    ],
                },
                {
                    label: 'Reference',
                    items: [{ slug: 'cli-reference' }, { slug: 'coverage' }, { slug: 'versioning' }],
                },
                {
                    label: 'Showcases',
                    collapsed: true,
                    items: [
                        { slug: 'showcases', label: 'Overview' },
                        { slug: 'showcases/adwaita-storybook' },
                        { slug: 'showcases/canvas2d-fireworks' },
                        { slug: 'showcases/excalibur-jelly-jumper' },
                        { slug: 'showcases/three-geometry-teapot' },
                        { slug: 'showcases/three-loader-ldraw' },
                        { slug: 'showcases/three-postprocessing-pixel' },
                        { slug: 'showcases/minimalist-browser' },
                        { slug: 'showcases/webrtc-loopback' },
                        { slug: 'showcases/webrtc-video' },
                        { slug: 'showcases/express-webserver' },
                    ],
                },
                {
                    label: 'Internals',
                    collapsed: true,
                    items: [
                        { slug: 'how-it-works' },
                        { slug: 'projects/ts-for-gir' },
                        { slug: 'projects/node-gi' },
                        { slug: 'projects/napi' },
                    ],
                },
                {
                    label: 'Contributing',
                    collapsed: true,
                    items: [
                        { slug: 'contributing/development-setup' },
                        { slug: 'contributing/architecture' },
                        { slug: 'contributing/tdd-workflow' },
                    ],
                },
            ],
            customCss: ['@gjsify/adwaita-fonts', '@gjsify/adwaita-web/style.css', './src/styles/custom.css'],
            defaultLocale: 'root',
            locales: {
                root: { label: 'English', lang: 'en' },
            },
        }),
    ],
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import blueprintPlugin from '@gjsify/vite-plugin-blueprint';

const blueprintGrammar = JSON.parse(
    readFileSync(new URL('./src/grammars/blueprint.tmLanguage.json', import.meta.url), 'utf8'),
);

export default defineConfig({
    site: 'https://gjsify.github.io',
    base: '/gjsify',
    trailingSlash: 'always',
    // Old URLs of pages that moved or were merged away. Destinations must spell out the `/gjsify`
    // base, because Astro does not prefix redirect targets with `base`.
    //
    // `/widgets/*` became `/adwaita/*`: the section only ever covered Adwaita, and naming it after
    // the design system leaves room for a second one beside it rather than under it. When four
    // `Gtk.*` gallery blocks arrived that premise stopped holding, so `Gtk` is a section BESIDE
    // `Adwaita`, per ADR 0034 § 1 — a widget belongs to the library that owns its GType. That is
    // measurable per page:
    //
    //     for f in website/src/content/docs/*/[a-z]*.mdx; do
    //       printf '%-34s Adw=%s Gtk=%s\n' "$f" \
    //         "$(grep -c '<AdwWidget title="Adw\.' $f)" "$(grep -c '<AdwWidget title="Gtk\.' $f)"
    //     done
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
        // A one-Blueprint gallery block (`<AdwWidget blueprint="…">`) reads its `.blp` as a
        // `?shared-tree` projection, which only this plugin answers — the plugin every `gjsify
        // build` target registers, so the preview is built from the same projection the
        // NativeScript and web loaders on the page import.
        plugins: [blueprintPlugin()],
        resolve: {
            alias: {
                // Both ship exports pointing at lib/esm, which this website never builds (it
                // resolves workspace packages from src), so map them to src here. Not via a
                // `browser` → ./src export condition: that spelling broke published `--app gjs`
                // consumers and was removed for it.
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
            description: 'GTK 4 & Adwaita everywhere, in type-safe TypeScript — on GJS, Node.js, Bun or Deno',
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
            // Ordered for someone who wants to USE gjsify: everything above `More` answers "how do
            // I…". `Gtk`/`Adwaita` stay group labels nested under `Widgets`, because arm 11 of
            // `scripts/check-website-adwaita-gallery.mjs` holds a page's slug against its GROUP
            // (ADR 0034 § 1). Gtk leads that group: it is the library Adwaita is built ON (there
            // is no `Adw.Entry`, no `Adw.DropDown`, no `Adw.MenuButton`). The order is presentation
            // only — arm 11 reads each group by its `label`, not by its position.
            sidebar: [
                {
                    label: 'Start',
                    items: [
                        { slug: 'overview' },
                        { slug: 'getting-started' },
                        { slug: 'guides/install' },
                        { slug: 'runtimes' },
                    ],
                },
                {
                    label: 'Widgets',
                    items: [
                        {
                            label: 'Gtk',
                            items: [
                                { slug: 'gtk', label: 'Gallery' },
                                { slug: 'gtk/controls' },
                                { slug: 'gtk/buttons' },
                                { slug: 'gtk/indicators' },
                                { slug: 'gtk/layout' },
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
                    ],
                },
                {
                    label: 'Platforms & shipping',
                    items: [
                        { slug: 'platform-support' },
                        { slug: 'ship', label: 'Overview' },
                        { slug: 'ship/linux-packages', label: 'Linux' },
                        { slug: 'ship/macos', label: 'macOS' },
                        { slug: 'ship/windows', label: 'Windows' },
                        { slug: 'ship/signing', label: 'Signing' },
                        { slug: 'guides/bundled-fonts', label: 'Bundled Fonts' },
                        { slug: 'guides/flatpak-app', label: 'Flatpak: GUI App' },
                        { slug: 'guides/flatpak-cli-tool', label: 'Flatpak: CLI Tool' },
                        { slug: 'guides/distributing-gjs-apps', label: 'One-Line Installer' },
                        { slug: 'guides/self-executing-package', label: 'Self-Executing Bundle' },
                        { slug: 'guides/dlx-packaging', label: 'Run via dlx' },
                    ],
                },
                {
                    label: 'Reference',
                    items: [
                        { slug: 'cli-reference' },
                        { slug: 'packages/overview' },
                        { slug: 'packages/node', label: 'Node.js' },
                        { slug: 'packages/web', label: 'Web APIs' },
                        { slug: 'packages/dom', label: 'DOM & Graphics' },
                        { slug: 'coverage' },
                        { slug: 'versioning' },
                    ],
                },
                {
                    // Third-party paradigms gjsify can host but does not own, a page here
                    // is an offer rather than a route, and so is most of this group: the
                    // apps people build with gjsify do not need any of it.
                    label: 'More',
                    collapsed: true,
                    items: [
                        {
                            label: 'Frameworks',
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
                            label: 'Guides',
                            items: [
                                { slug: 'guides/native-adwaita-app' },
                                { slug: 'guides/web-views' },
                                { slug: 'guides/storybook' },
                                { slug: 'guides/devtools' },
                                { slug: 'guides/vite-plugin' },
                                { slug: 'guides/webrtc' },
                                { slug: 'guides/browser-extensions' },
                            ],
                        },
                        {
                            label: 'Patterns',
                            items: [
                                { slug: 'patterns/gobject-classes' },
                                { slug: 'patterns/bridges', label: 'Bridge Widgets' },
                            ],
                        },
                        {
                            // The mechanism, the rationale and the bridge projects:
                            // everything a newcomer can skip and an author can need.
                            label: 'Internals',
                            items: [
                                { slug: 'how-it-works' },
                                { slug: 'projects/ts-for-gir' },
                                { slug: 'projects/node-gi' },
                                { slug: 'projects/napi' },
                            ],
                        },
                        {
                            label: 'Showcases',
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
                            // Third-party paradigms gjsify can host but does not own, and does not
                            // recommend by default. A page here is an offer, not a route: it has to
                            // say who should skip it before it says what it does.
                            label: 'Experiments',
                            items: [{ slug: 'experiments/effect', label: 'Effect' }],
                        },
                        {
                            label: 'Contributing',
                            items: [
                                { slug: 'contributing/development-setup' },
                                { slug: 'contributing/architecture' },
                                { slug: 'contributing/tdd-workflow' },
                            ],
                        },
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

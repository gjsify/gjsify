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
    // Old URLs of pages that were merged away. Destinations must spell out the
    // `/gjsify` base — Astro does not prefix redirect targets with `base`.
    redirects: {
        '/framework/bridges': '/gjsify/patterns/bridges/',
        '/patterns': '/gjsify/patterns/gobject-classes/',
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
            sidebar: [
                {
                    label: 'Start',
                    items: [
                        { slug: 'overview' },
                        { slug: 'getting-started' },
                        { slug: 'runtimes' },
                        { slug: 'platform-support' },
                        { slug: 'how-it-works' },
                        { slug: 'guides/install' },
                    ],
                },
                {
                    label: 'Guides',
                    items: [
                        { slug: 'guides/native-adwaita-app' },
                        { slug: 'patterns/gobject-classes' },
                        { slug: 'patterns/bridges', label: 'Bridge Widgets' },
                        { slug: 'guides/storybook' },
                        { slug: 'guides/devtools' },
                        { slug: 'guides/vite-plugin' },
                    ],
                },
                {
                    label: 'Widgets',
                    items: [
                        { slug: 'widgets', label: 'Gallery' },
                        { slug: 'widgets/boxed-lists' },
                        { slug: 'widgets/buttons' },
                        { slug: 'widgets/layout' },
                        { slug: 'widgets/navigation' },
                        { slug: 'widgets/view-switching' },
                        { slug: 'widgets/presentation' },
                        { slug: 'widgets/feedback' },
                        { slug: 'widgets/theming' },
                    ],
                },
                {
                    label: 'Distribute',
                    items: [
                        { slug: 'guides/distributing-gjs-apps', label: 'One-Line Installer' },
                        { slug: 'guides/dlx-packaging', label: 'Run via dlx' },
                        { slug: 'guides/self-executing-package', label: 'Self-Executing Bundle' },
                        { slug: 'guides/flatpak-app', label: 'Flatpak: GUI App' },
                        { slug: 'guides/flatpak-cli-tool', label: 'Flatpak: CLI Tool' },
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
                    label: 'Ecosystem',
                    items: [{ slug: 'projects/ts-for-gir' }, { slug: 'projects/node-gi' }, { slug: 'projects/napi' }],
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
                        { slug: 'showcases/three-postprocessing-pixel' },
                        { slug: 'showcases/minimalist-browser' },
                        { slug: 'showcases/webrtc-loopback' },
                        { slug: 'showcases/webrtc-video' },
                        { slug: 'showcases/express-webserver' },
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
            customCss: [
                '@gjsify/adwaita-fonts',
                '@gjsify/adwaita-fonts/400-italic.css',
                '@gjsify/adwaita-web/style.css',
                './src/styles/custom.css',
            ],
            defaultLocale: 'root',
            locales: {
                root: { label: 'English', lang: 'en' },
            },
        }),
    ],
});

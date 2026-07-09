import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
    site: 'https://gjsify.github.io',
    base: '/gjsify',
    trailingSlash: 'always',
    // The Framework/Bridges page was merged into Patterns/Bridges (single source).
    // Keep the old URL alive.
    redirects: {
        '/framework/bridges': '/patterns/bridges',
    },
    vite: {
        resolve: {
            alias: {
                // @gjsify/stories + @gjsify/storybook-core ship exports pointing at lib/esm
                // (the published tarball carries lib), but this workspace website never builds
                // workspace lib — it resolves packages from src (as it does @gjsify/adwaita-web).
                // Map these two to their src so the docs build resolves them without a lib build.
                // (They previously carried a `browser` → ./src condition, removed in the export fix
                // that unbroke published --app gjs consumers; that resolution now lives here.)
                '@gjsify/stories': fileURLToPath(new URL('../packages/framework/stories/src/index.ts', import.meta.url)),
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
            description: 'The full JavaScript ecosystem, native on GNOME',
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
            sidebar: [
                {
                    label: 'Documentation',
                    items: [
                        { slug: 'overview' },
                        { slug: 'getting-started' },
                        { slug: 'cli-reference' },
                        { slug: 'how-it-works' },
                        { slug: 'versioning' },
                        { slug: 'coverage' },
                    ],
                },
                {
                    label: 'Guides',
                    items: [
                        { slug: 'guides/install' },
                        { slug: 'guides/distributing-gjs-apps' },
                        { slug: 'guides/dlx-packaging' },
                        { slug: 'guides/self-executing-package' },
                        { slug: 'guides/flatpak-app' },
                        { slug: 'guides/flatpak-cli-tool' },
                        { slug: 'guides/devtools' },
                        { slug: 'guides/native-adwaita-app' },
                        { slug: 'guides/storybook' },
                    ],
                },
                {
                    label: 'Packages',
                    items: [
                        { slug: 'packages/overview' },
                        { slug: 'packages/node' },
                        { slug: 'packages/web' },
                        { slug: 'packages/dom' },
                    ],
                },
                {
                    label: 'Patterns',
                    items: [
                        { slug: 'patterns', label: 'Overview' },
                        { slug: 'patterns/gobject-classes' },
                        { slug: 'patterns/bridges' },
                    ],
                },
                {
                    label: 'Projects',
                    items: [
                        { slug: 'projects/ts-for-gir' },
                        { slug: 'projects/node-gi', badge: { text: 'Experimental', variant: 'caution' } },
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
                        { slug: 'showcases/three-postprocessing-pixel' },
                        { slug: 'showcases/minimalist-browser' },
                        { slug: 'showcases/webrtc-loopback' },
                        { slug: 'showcases/webrtc-video' },
                        { slug: 'showcases/express-webserver' },
                    ],
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

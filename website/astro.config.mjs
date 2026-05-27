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
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/gjsify/gjsify' },
      ],
      sidebar: [
        {
          label: 'Documentation',
          items: [
            { slug: 'getting-started' },
            { slug: 'cli-reference' },
            { slug: 'how-it-works' },
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
          ],
        },
        {
          label: 'Showcases',
          items: [
            { slug: 'showcases', label: 'Overview' },
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

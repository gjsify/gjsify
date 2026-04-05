import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://gjsify.github.io',
  base: '/gjsify',
  trailingSlash: 'always',
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
            { slug: 'architecture' },
            { slug: 'contributing' },
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
      ],
      customCss: [
        '@gjsify/adwaita-fonts',
        '@gjsify/adwaita-fonts/400-italic.css',
        './src/styles/custom.css',
      ],
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
      },
    }),
  ],
});

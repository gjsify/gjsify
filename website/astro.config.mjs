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
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      favicon: '/favicon.ico',
      social: {
        github: 'https://github.com/gjsify/gjsify',
      },
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
      customCss: ['./src/styles/custom.css'],
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
      },
    }),
  ],
});

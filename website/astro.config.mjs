import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://gjsify.github.io',
  base: '/gjsify',
  integrations: [
    starlight({
      title: 'gjsify',
      description: 'The full JavaScript ecosystem, native on GNOME',
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

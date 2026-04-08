/* 
temporary while we work on excalibur features alongside this example.
vite needs some additional configuration when excalibur is symlinked.
should be removed once example is ready to be published.
*/

import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy';
import fs from 'fs'

const isExcaliburSymlinked =
  fs.existsSync('./node_modules/excalibur') &&
  fs.lstatSync('./node_modules/excalibur').isSymbolicLink()

const BASE_URL = process.env.NODE_ENV === 'production' ? '/sample-jelly-jumper/' : '/';

export default defineConfig({
  base: BASE_URL,
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'social.jpg',
          dest: 'assets'
        }
      ]
    })
  ],
  optimizeDeps: {
    include: isExcaliburSymlinked ? [] : ['excalibur'],
  },
  resolve: {
    dedupe: isExcaliburSymlinked ? ['excalibur'] : [],
  },
})

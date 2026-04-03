// Expressive Code configuration for GJSify website.
// Uses Adwaita-style frames plugin to render code blocks as adw-window elements.
import { defineEcConfig } from '@astrojs/starlight/expressive-code'
import { pluginAdwaitaFrames } from './src/ec-plugins/adwaita-frames.mjs'

export default defineEcConfig({
  plugins: [pluginAdwaitaFrames()],
})

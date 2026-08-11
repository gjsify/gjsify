import { defineEcConfig } from '@astrojs/starlight/expressive-code';
import { pluginAdwaitaFrames } from './src/ec-plugins/adwaita-frames.mjs';

export default defineEcConfig({
    plugins: [pluginAdwaitaFrames()],
});

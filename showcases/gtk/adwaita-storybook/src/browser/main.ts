// Browser entry — mounts the Adwaita storybook as a web app built from
// @gjsify/adwaita-web custom elements, mirroring the native GTK storybook
// (launched via `gjsify storybook`). Each *.web.ts story shares its metadata
// with the GTK *.story.ts twin, so the two targets expose identical controls
// and can be compared 1:1 via screenshots.
//
// The story list lives in `./stories.ts` so the standalone entry here and the
// embeddable `mount(container)` (`./embed.ts`, used by the gjsify website) stay
// in lockstep.

import { mountStorybook } from '@gjsify/adwaita-storybook';
import { stories } from './stories.js';

mountStorybook(document.body, { title: 'Adwaita Storybook', stories });

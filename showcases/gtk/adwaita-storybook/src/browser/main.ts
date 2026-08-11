// Browser entry, mounting the storybook from @gjsify/adwaita-web custom elements as a mirror of the
// native GTK one (`gjsify storybook`). Each *.web.ts story shares metadata with its GTK *.story.ts
// twin, so both targets expose identical controls. Parity is BEHAVIOURAL, asserted by both renderer
// suites against the @gjsify/adwaita-core/conformance vectors — there is no screenshot harness
// (#1052).
//
// The story list is in ./stories.ts so this standalone entry and the embeddable `mount(container)`
// in ./embed.ts stay in lockstep.

import { mountStorybook } from '@gjsify/adwaita-storybook';
import { stories } from './stories.js';

mountStorybook(document.body, { title: 'Adwaita Storybook', stories });

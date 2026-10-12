import { run } from '@gjsify/unit';

import settingsSpec from './settings.spec.js';
import settingsGjsSpec from './settings.gjs.spec.js';

run({ settingsSpec, settingsGjsSpec });

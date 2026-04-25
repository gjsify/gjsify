import { run } from '@gjsify/unit';

import { ErrorHandlerTest } from './error-handler.spec.js';
import { EventTargetTest } from './event-target.spec.js';
import { EventTest } from './event.spec.js';
import { UIEventsTest } from './ui-events.spec.js';

run({ ErrorHandlerTest, EventTargetTest, EventTest, UIEventsTest });

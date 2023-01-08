
import { run } from '@gjsify/unit';

import { ErrorHandlerTest } from './error-handler.spec';
import { EventTargetTest } from './event-target.spec';
import { EventTest } from './event.spec';

run({ErrorHandlerTest, EventTargetTest, EventTest});
import { run } from '@gjsify/unit';

import { ErrorHandlerTest } from './error-handler.spec';
import { EventTargetTest } from './event-target.spec';
import { EventTest } from './event.spec';
import { UIEventsTest } from './ui-events.spec';
import { WindowEventBusTest } from './window-event-bus.spec';

run({ ErrorHandlerTest, EventTargetTest, EventTest, UIEventsTest, WindowEventBusTest });

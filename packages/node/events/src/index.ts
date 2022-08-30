import EventEmitter2 from 'eventemitter2';

(EventEmitter2 as any).EventEmitter = EventEmitter2
export const EventEmitter = EventEmitter2
export default EventEmitter
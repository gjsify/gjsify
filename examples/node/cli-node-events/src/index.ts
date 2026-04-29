import { EventEmitter } from 'events';

console.log('=== @gjsify/events example ===\n');

// Basic emit and listen
const emitter = new EventEmitter();

emitter.on('greet', (name: string) => {
  console.log(`Hello, ${name}!`);
});

console.log('--- Basic emit ---');
emitter.emit('greet', 'GJS');
emitter.emit('greet', 'World');

// once listener
console.log('\n--- once listener ---');
emitter.once('startup', () => {
  console.log('This fires only once');
});
emitter.emit('startup');
emitter.emit('startup'); // silent, listener was removed

// Multiple listeners
console.log('\n--- Multiple listeners ---');
const ee = new EventEmitter();
ee.on('data', (chunk: string) => console.log('  Listener A:', chunk));
ee.on('data', (chunk: string) => console.log('  Listener B:', chunk));
ee.emit('data', 'some payload');

// Listener count
console.log('Listener count for "data":', ee.listenerCount('data'));

// Remove listener
const handler = () => console.log('  I should be removed');
ee.on('temp', handler);
console.log('Before removeListener, count:', ee.listenerCount('temp'));
ee.removeListener('temp', handler);
console.log('After removeListener, count:', ee.listenerCount('temp'));

// Error handling
console.log('\n--- Error event ---');
const safe = new EventEmitter();
safe.on('error', (err: Error) => {
  console.log('Caught error:', err.message);
});
safe.emit('error', new Error('something went wrong'));

// eventNames
console.log('\n--- Event names ---');
const multi = new EventEmitter();
multi.on('foo', () => {});
multi.on('bar', () => {});
multi.on('baz', () => {});
console.log('eventNames():', multi.eventNames());

console.log('\n=== events example complete ===');

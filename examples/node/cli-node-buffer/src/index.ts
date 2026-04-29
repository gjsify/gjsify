import { Buffer } from 'buffer';

console.log('=== @gjsify/buffer example ===\n');

// Buffer.alloc
const buf1 = Buffer.alloc(10);
console.log('Buffer.alloc(10) length:', buf1.length);

// Buffer.alloc with fill
const buf2 = Buffer.alloc(5, 0x41);
console.log('Buffer.alloc(5, 0x41).toString():', buf2.toString());

// Buffer.from string
const buf3 = Buffer.from('Hello, GJS!');
console.log('Buffer.from("Hello, GJS!").toString():', buf3.toString());
console.log('  length:', buf3.length);

// Buffer.from with hex encoding
const buf4 = Buffer.from('48656c6c6f', 'hex');
console.log('Buffer.from("48656c6c6f", "hex").toString():', buf4.toString());

// Buffer.from base64
const buf5 = Buffer.from('SGVsbG8gV29ybGQ=', 'base64');
console.log('Buffer.from("SGVsbG8gV29ybGQ=", "base64").toString():', buf5.toString());

// Buffer.from array
const buf6 = Buffer.from([72, 101, 108, 108, 111]);
console.log('Buffer.from([72, 101, 108, 108, 111]).toString():', buf6.toString());

// Buffer.concat
const combined = Buffer.concat([Buffer.from('Hello'), Buffer.from(' '), Buffer.from('World')]);
console.log('Buffer.concat(...):', combined.toString());

// Buffer comparison
const a = Buffer.from('abc');
const b = Buffer.from('abc');
const c = Buffer.from('def');
console.log('Buffer.from("abc").equals(Buffer.from("abc")):', a.equals(b));
console.log('Buffer.from("abc").equals(Buffer.from("def")):', a.equals(c));

// Slice / subarray
const original = Buffer.from('Hello World');
const slice = original.subarray(0, 5);
console.log('Buffer.from("Hello World").subarray(0, 5).toString():', slice.toString());

console.log('\n=== buffer example complete ===');

import { homedir, hostname, tmpdir, cpus, EOL, type, release, userInfo, endianness } from 'os';

console.log('=== @gjsify/os example ===\n');

// Basic info
console.log('homedir():', homedir());
console.log('hostname():', hostname());
console.log('tmpdir():', tmpdir());
console.log('type():', type());
console.log('release():', release());
console.log('endianness():', endianness());
console.log('EOL:', JSON.stringify(EOL));

// User info
console.log('\n--- userInfo ---');
const info = userInfo();
console.log('username:', info.username);
console.log('homedir:', info.homedir);
console.log('uid:', info.uid);

// CPUs
console.log('\n--- cpus ---');
const cpuList = cpus();
if (cpuList && cpuList.length > 0) {
  console.log('Number of CPUs:', cpuList.length);
  console.log('First CPU model:', cpuList[0].model);
  console.log('First CPU speed:', cpuList[0].speed, 'MHz');
} else {
  console.log('CPU info not available on this platform');
}

console.log('\n=== os example complete ===');

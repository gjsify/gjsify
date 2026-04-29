// Interactive DNS lookup tool for Node.js and GJS
// Demonstrates: dns (lookup, resolve4, resolve6, reverse), readline, net.isIP

import { runtimeName } from '@gjsify/runtime';
import { lookup, resolve4, resolve6, reverse } from 'node:dns';
import { isIP, isIPv4, isIPv6 } from 'node:net';

// ANSI colors
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

/** Promisified dns.lookup */
function lookupAsync(hostname: string): Promise<{ address: string; family: number }> {
  return new Promise((resolve, reject) => {
    lookup(hostname, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
  });
}

/** Promisified dns.resolve4 */
function resolve4Async(hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    resolve4(hostname, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

/** Promisified dns.resolve6 */
function resolve6Async(hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    resolve6(hostname, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

/** Promisified dns.reverse */
function reverseAsync(ip: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    reverse(ip, (err, hostnames) => {
      if (err) reject(err);
      else resolve(hostnames);
    });
  });
}

/** Perform all DNS lookups for a hostname. */
async function lookupHostname(hostname: string): Promise<void> {
  console.log(`\n${BOLD}${CYAN}DNS lookup: ${hostname}${RESET}\n`);

  // dns.lookup (uses OS resolver)
  try {
    const { address, family } = await lookupAsync(hostname);
    console.log(`  ${GREEN}lookup:${RESET}    ${address} (IPv${family})`);
  } catch (err: unknown) {
    console.log(`  ${RED}lookup:${RESET}    ${(err as Error).message}`);
  }

  // dns.resolve4 (A records)
  try {
    const ipv4 = await resolve4Async(hostname);
    console.log(`  ${GREEN}resolve4:${RESET}  ${ipv4.join(', ') || '(none)'}`);
  } catch (err: unknown) {
    console.log(`  ${DIM}resolve4:  ${(err as Error).message}${RESET}`);
  }

  // dns.resolve6 (AAAA records)
  try {
    const ipv6 = await resolve6Async(hostname);
    console.log(`  ${GREEN}resolve6:${RESET}  ${ipv6.join(', ') || '(none)'}`);
  } catch (err: unknown) {
    console.log(`  ${DIM}resolve6:  ${(err as Error).message}${RESET}`);
  }
}

/** Perform reverse DNS lookup for an IP. */
async function reverseLookup(ip: string): Promise<void> {
  console.log(`\n${BOLD}${CYAN}Reverse DNS: ${ip}${RESET}\n`);

  const version = isIPv4(ip) ? 'IPv4' : isIPv6(ip) ? 'IPv6' : 'unknown';
  console.log(`  ${GREEN}type:${RESET}      ${version} (isIP=${isIP(ip)})`);

  try {
    const hostnames = await reverseAsync(ip);
    console.log(`  ${GREEN}reverse:${RESET}   ${hostnames.join(', ') || '(no PTR records)'}`);
  } catch (err: unknown) {
    console.log(`  ${DIM}reverse:   ${(err as Error).message}${RESET}`);
  }
}

// Parse arguments
const argvOffset = process.argv.length >= 2 && /\.[cm]?[jt]s$/.test(process.argv[1]) ? 2 : 1;
const args = process.argv.slice(argvOffset);

console.log(`${DIM}gjsify DNS lookup tool — Runtime: ${runtimeName}${RESET}`);

if (args.length === 0) {
  // Demo mode: look up well-known hostnames
  console.log(`${DIM}No arguments provided. Running demo lookups...${RESET}`);

  const demoHosts = ['localhost', 'example.com'];
  for (const host of demoHosts) {
    await lookupHostname(host);
  }

  // Demo reverse lookup
  await reverseLookup('127.0.0.1');

  console.log(`\n${YELLOW}Usage:${RESET} dns-lookup <hostname|ip> [hostname|ip] ...`);
} else {
  for (const arg of args) {
    if (isIP(arg)) {
      await reverseLookup(arg);
    } else {
      await lookupHostname(arg);
    }
  }
}

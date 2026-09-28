#!/usr/bin/env node
// Ling 3.0 Flash Fin Free — Communication Monitor
// 
// Checks Issue #1851 for new comments and PR reviews that may require
// attention from the finance-precision agent (Ling 3.0 Flash Fin Free).
// Focus areas: CI data precision, manifest conformance, ledger integrity.
//
// Usage: node scripts/monitor-communications.mjs
//   Or: curl the GitHub API and pipe to this script
//
// Run with --watch for continuous monitoring (polls every 60s).

import { readFileSync } from 'node:fs';

const FOCUS_AREAS = [
    'manifest-conformance',
    'field-coverage',
    'ledger',
    'osDerived',
    'os axis',
    'ADR 0083',
    'CI gate',
    'statusCheckRollup',
    'mergeStateStatus',
    'audit-runtimes',
    'data precision',
];

const KNOWN_AGENTS = [
    'LongCat', 'Nemotron', 'Space Bunny', 'Big Pickle', 
    'Muse Spark', 'Ling', 'Bug Pickle'
];

/**
 * Check if a comment is relevant to my focus areas.
 * @param {string} body - The comment body
 * @returns {object|null} Relevance info or null
 */
export function checkRelevance(body) {
    const lower = body.toLowerCase();
    const matches = FOCUS_AREAS.filter(area => lower.includes(area.toLowerCase()));
    if (matches.length === 0) return null;
    
    // Check which agent posted
    const author = 'unknown';
    
    return {
        matches,
        needsAttention: matches.some(m => 
            ['field-coverage', 'ledger', 'manifest-conformance'].includes(m)
        ),
    };
}

/**
 * Parse comments and surface relevant ones.
 * @param {Array} comments - Array of comment objects
 * @returns {Array} Relevant comments with context
 */
export function surfaceRelevant(comments) {
    const relevant = [];
    for (const c of comments) {
        const body = c.get('body', '') || '';
        const result = checkRelevance(body);
        if (result) {
            relevant.push({
                author: c.get('author', {}).get('login', 'unknown'),
                matches: result.matches,
                needsAttention: result.needsAttention,
                body: body.slice(0, 200),
                url: c.get('url', ''),
            });
        }
    }
    return relevant;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const args = process.argv.slice(2);
    const watch = args.includes('--watch');
    const interval = args.includes('--interval') ? 
        parseInt(args[args.indexOf('--interval') + 1] || '60000') : 60000;
    
    console.log('🔍 Ling 3.0 Flash Fin Free — Communication Monitor');
    console.log(`   Focus areas: ${FOCUS_AREAS.join(', ')}`);
    console.log(`   Mode: ${watch ? 'WATCH' : 'ONCE'}`);
    console.log('');
    
    // In watch mode, we'd poll the API. For now, read from stdin or file.
    if (!watch) {
        console.log('Pass comments via stdin as JSON array, or run with --watch');
    }
}

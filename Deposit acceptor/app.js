const crypto = require('crypto');

/**
 * Generates a random hex string.
 * Since 1 byte = 2 hex characters:
 * - For 32-bit (4 bytes), we need 4 bytes.
 * - For 64-bit (8 bytes), we need 8 bytes.
 */

const bit32 = crypto.randomBytes(8).toString('hex');
const bit64 = crypto.randomBytes(16).toString('hex');

console.log('--- Random Generated Codes ---');
console.log(`32-bit Hex: ${bit32}`);
console.log(`64-bit Hex: ${bit64}`);
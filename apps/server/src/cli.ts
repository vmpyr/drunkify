#!/usr/bin/env node

const [command] = process.argv.slice(2);

if (command === '--help' || command === undefined) {
  console.log('drunkify CLI — database and admin commands arrive in milestone M1/M2');
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);

#!/usr/bin/env node

import { loadConfig } from './config.js';
import { createDb } from './db/createDb.js';

const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
const [command, subcommand] = args;

if (command === '--help' || command === undefined) {
  console.log('Usage: drunkify db migrate');
  process.exit(0);
}

if (command === 'db' && subcommand === 'migrate') {
  const db = createDb(loadConfig());
  try {
    await db.migrate();
    console.log(`Database migrations complete (${db.driver})`);
  } finally {
    await db.close();
  }
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);

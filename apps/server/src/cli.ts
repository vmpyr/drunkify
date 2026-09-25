#!/usr/bin/env node

import { v7 as uuidv7 } from 'uuid';

import { generateSessionToken, hashToken } from './auth/tokens.js';
import { loadConfig } from './config.js';
import { createDb } from './db/createDb.js';
import { M2Store } from './db/m2Store.js';

const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
const [command, subcommand] = args;

if (command === '--help' || command === undefined) {
  console.log(
    'Usage: drunkify db migrate | admin reset-link [--email <email>] | admin set-email <email>',
  );
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

if (command === 'admin' && subcommand === 'reset-link') {
  const config = loadConfig();
  const db = createDb(config);
  try {
    await db.migrate();
    const store = new M2Store(db);
    const emailFlag = args.indexOf('--email');
    const email =
      emailFlag >= 0 && args[emailFlag + 1] ? args[emailFlag + 1]!.trim().toLowerCase() : undefined;
    const user = email ? await store.findUserByEmail(email) : await store.findAdmin();
    if (!user) throw new Error('User not found');
    if (user.disabledAt !== null) throw new Error('User is disabled');
    const token = generateSessionToken();
    await store.createReset({
      id: uuidv7(),
      userId: user.id,
      tokenHash: hashToken(token),
      createdBy: (await store.findAdmin())?.id ?? null,
      now: Date.now(),
    });
    const publicUrl = (config.PUBLIC_URL ?? `http://localhost:${config.PORT}`).replace(/\/$/, '');
    console.log(`${publicUrl}/r/${token}`);
  } finally {
    await db.close();
  }
  process.exit(0);
}

if (command === 'admin' && subcommand === 'set-email') {
  const newEmail = args[2]?.trim().toLowerCase();
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    throw new Error('A valid email is required');
  }
  const db = createDb(loadConfig());
  try {
    await db.migrate();
    const store = new M2Store(db);
    const admin = await store.findAdmin();
    if (!admin) throw new Error('Admin not found');
    if ((await store.updateEmail(admin.id, newEmail, Date.now())) === 'email_taken') {
      throw new Error('Email is already in use');
    }
    console.log(newEmail);
  } finally {
    await db.close();
  }
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);

#!/usr/bin/env tsx
/**
 * Create a Matrix Space with configuration options
 *
 * Usage:
 *   npx tsx create-space.ts --name "My Space" [--type private|open|invite]
 *
 * Or create .env file with MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN, MATRIX_USER_ID
 */

import * as sdk from 'matrix-js-sdk';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Try to load .env from multiple locations
const possibleEnvPaths = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '..', '..', '.env'),
  path.join(__dirname, '.env'),
];

for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}

const HOMESERVER_URL = process.env.MATRIX_HOMESERVER_URL!;
const ACCESS_TOKEN = process.env.MATRIX_ACCESS_TOKEN!;
const USER_ID = process.env.MATRIX_USER_ID!;

if (!HOMESERVER_URL || !ACCESS_TOKEN || !USER_ID) {
  console.error('Error: MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN, and MATRIX_USER_ID required');
  console.error('Create .env file or set environment variables');
  process.exit(1);
}

// Parse args
const args = process.argv.slice(2);
let spaceName = '';
let spaceType: 'private' | 'open' | 'invite' = 'private';

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--name':
      spaceName = args[++i] || '';
      break;
    case '--type':
      const typeArg = args[++i] as 'private' | 'open' | 'invite';
      if (['private', 'open', 'invite'].includes(typeArg)) {
        spaceType = typeArg;
      }
      break;
  }
}

// Interactive mode if no name provided
if (!spaceName) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('=== Create Matrix Space ===\n');
  console.log('Space types:');
  console.log('  private - Private space, invite only (default)');
  console.log('  open    - Open space, anyone can join via link');
  console.log('  invite  - Like private, but stricter permissions');
  console.log('');

  const askName = () =>
    new Promise<string>((resolve) => {
      rl.question('Space name: ', (answer: string) => resolve(answer.trim()));
    });

  const askType = () =>
    new Promise<'private' | 'open' | 'invite'>((resolve) => {
      rl.question('Type [private/open/invite]: ', (answer: string) => {
        const type = (answer.trim() || 'private') as 'private' | 'open' | 'invite';
        if (['private', 'open', 'invite'].includes(type)) {
          resolve(type);
        } else {
          console.log('Invalid type, using "private"');
          resolve('private');
        }
      });
    });

  (async () => {
    spaceName = await askName();
    while (!spaceName) {
      console.log('Name is required');
      spaceName = await askName();
    }
    spaceType = await askType();
    rl.close();
    await createSpace();
  })();
} else {
  createSpace();
}

async function createSpace() {
  const client = sdk.createClient({
    baseUrl: HOMESERVER_URL,
    accessToken: ACCESS_TOKEN,
    userId: USER_ID,
  });

  console.log(`\nCreating "${spaceName}" space (${spaceType})...\n`);

  const joinRule = spaceType === 'open' ? 'public' : 'invite';
  const preset = spaceType === 'open' ? sdk.Preset.PublicChat : sdk.Preset.PrivateChat;
  const visibility = spaceType === 'open' ? sdk.Visibility.Public : sdk.Visibility.Private;

  try {
    const { room_id } = await client.createRoom({
      name: spaceName,
      room_version: '10',
      preset: preset,
      visibility: visibility,
      initial_state: [
        {
          type: 'm.room.type',
          content: { type: 'm.space' },
          state_key: '',
        },
        {
          type: 'm.room.join_rules',
          content: { join_rule: joinRule },
          state_key: '',
        },
        {
          type: 'm.room.power_levels',
          content: {
            users: { [USER_ID]: 100 },
            users_default: 0,
            events: {
              'm.room.name': 50,
              'm.room.power_levels': 100,
              'm.room.history_visibility': 100,
              'm.room.canonical_alias': 50,
              'm.room.avatar': 50,
              'm.space.child': 50,
            },
            events_default: 0,
            state_default: 50,
            ban: 50,
            kick: 50,
            redact: 50,
            invite: 0,
          },
          state_key: '',
        },
      ],
    });

    console.log('✓ Space created successfully!');
    console.log(`  Room ID: ${room_id}`);
    console.log(`  Type: ${spaceType}`);
    console.log(`  Join Rule: ${joinRule}`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Add rooms with: npx tsx link-room-to-space.ts');
    console.log('  2. Invite members with: npx tsx invite-picker.ts');
    console.log('  3. Manage space with: npx tsx manage-space.ts');

    // Save to .env.local for easy reference
    const envLocal = path.join(process.cwd(), '.env.local');
    fs.appendFileSync(envLocal, `\n# Created space:\n# MATRIX_SPACE_ID="${room_id}"\n`, { flag: 'a' });
    console.log(`\nRoom ID saved to .env.local`);

  } catch (err) {
    console.error('✗ Failed to create space:', (err as Error).message);
    process.exit(1);
  }

  client.stopClient();
}

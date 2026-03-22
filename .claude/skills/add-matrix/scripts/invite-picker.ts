#!/usr/bin/env tsx
/**
 * Invite users to Matrix Space or Room with interactive picker
 *
 * Usage:
 *   npx tsx invite-picker.ts --room "!room:server.com" [--space]
 *
 * Or create .env file with MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN, MATRIX_USER_ID
 */

import * as sdk from 'matrix-js-sdk';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

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
  process.exit(1);
}

// Parse args
const args = process.argv.slice(2);
let targetRoom = '';
let isSpace = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--room':
    case '-r':
      targetRoom = args[++i] || '';
      break;
    case '--space':
    case '-s':
      isSpace = true;
      break;
  }
}

const client = sdk.createClient({
  baseUrl: HOMESERVER_URL,
  accessToken: ACCESS_TOKEN,
  userId: USER_ID,
});

async function main() {
  console.log('=== Matrix Invite Picker ===\n');

  // Get target room/space
  if (!targetRoom) {
    // List available rooms/spaces
    console.log('Connecting to Matrix...');
    await client.startClient({ initialSyncLimit: 0 });

    await new Promise<void>((resolve) => {
      client.once(sdk.ClientEvent.Sync, (state) => {
        if (state === sdk.SyncState.Prepared) resolve();
      });
    });

    const rooms = client.getRooms();
    const spaces = rooms.filter((r) => {
      const typeEvent = r.currentState.getStateEvents('m.room.type', '');
      return typeEvent?.getContent()?.type === 'm.space';
    });
    const regularRooms = rooms.filter((r) => !spaces.includes(r));

    console.log('\nSelect target:');
    console.log('');

    if (spaces.length > 0) {
      console.log('-- Spaces --');
      spaces.forEach((s, i) => {
        console.log(`  [S${i + 1}] ${s.name} (${s.getJoinedMemberCount()} members)`);
      });
      console.log('');
    }

    console.log('-- Rooms --');
    regularRooms.forEach((r, i) => {
      console.log(`  [${i + 1}] ${r.name || '(unnamed)'} (${r.getJoinedMemberCount()} members)`);
    });
    console.log('');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('Enter number (or S# for space): ', resolve);
    });
    rl.close();

    const trimmed = answer.trim();
    if (trimmed.startsWith('S') || trimmed.startsWith('s')) {
      const idx = parseInt(trimmed.slice(1)) - 1;
      if (idx >= 0 && idx < spaces.length) {
        targetRoom = spaces[idx].roomId;
        isSpace = true;
      }
    } else {
      const idx = parseInt(trimmed) - 1;
      if (idx >= 0 && idx < regularRooms.length) {
        targetRoom = regularRooms[idx].roomId;
      }
    }

    if (!targetRoom) {
      console.error('Invalid selection');
      process.exit(1);
    }

    console.log(`\nSelected: ${isSpace ? 'Space' : 'Room'} ${targetRoom}\n`);
  }

  // Get current room members
  const room = client.getRoom(targetRoom);
  if (!room) {
    console.error('Room not found. Make sure you are joined to it.');
    process.exit(1);
  }

  const existingMembers = new Set<string>();
  room.getJoinedMembers().forEach((m) => existingMembers.add(m.userId));

  // Show current members
  console.log('Current members:');
  room.getJoinedMembers().forEach((m) => {
    console.log(`  - ${m.name} (${m.userId})`);
  });
  console.log('');

  // Invite options
  console.log('Invite options:');
  console.log('  1. Invite by Matrix ID (@user:server.com)');
  console.log('  2. Create invite link (for restricted rooms)');
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const choice = await new Promise<string>((resolve) => {
    rl.question('Select option [1/2]: ', resolve);
  });

  if (choice.trim() === '1') {
    // Invite by Matrix ID
    const matrixId = await new Promise<string>((resolve) => {
      rl.question('Matrix ID to invite (@user:server.com): ', resolve);
    });

    const trimmedId = matrixId.trim();
    if (!trimmedId.match(/^@.+:.+$/)) {
      console.error('Invalid Matrix ID format. Should be @user:server.com');
      rl.close();
      process.exit(1);
    }

    if (existingMembers.has(trimmedId)) {
      console.error('User is already a member!');
      rl.close();
      process.exit(1);
    }

    console.log(`\nInviting ${trimmedId}...`);

    try {
      await client.invite(targetRoom, trimmedId);
      console.log('✓ Invitation sent successfully!');
    } catch (err) {
      console.error('✗ Failed to invite:', (err as Error).message);
      rl.close();
      process.exit(1);
    }
  } else if (choice.trim() === '2') {
    // Show room is restricted notice
    const joinRules = room.currentState.getStateEvents('m.room.join_rules', '');
    const joinRule = joinRules?.getContent()?.join_rule;

    if (joinRule === 'restricted') {
      console.log('\nThis room has restricted join rules.');
      console.log('Users in allowed spaces can join directly without invitation.');

      // Show allowed spaces
      const allow = joinRules?.getContent()?.allow || [];
      if (allow.length > 0) {
        console.log('\nAllowed spaces:');
        allow.forEach((rule: { type: string; room_id: string }) => {
          if (rule.type === 'm.room_membership') {
            console.log(`  - ${rule.room_id}`);
          }
        });
      }
      console.log('\nShare this room ID with users in allowed spaces:');
      console.log(`  ${targetRoom}`);
    } else if (joinRule === 'public') {
      console.log('\nThis room is public. Anyone can join via:');
      console.log(`  ${HOMESERVER_URL}/#/room/${encodeURIComponent(targetRoom)}`);
    } else {
      console.log('\nRoom is invite-only. Cannot create public link.');
      console.log('Share the Room ID and invite users individually.');
    }
  }

  rl.close();
  client.stopClient();
  console.log('');
}

main().catch((err) => {
  console.error('Error:', err.message);
  client.stopClient();
  process.exit(1);
});

#!/usr/bin/env tsx
/**
 * Link a room to a Matrix Space (or unlink)
 *
 * Usage:
 *   npx tsx link-room-to-space.ts [--link|--unlink]
 *
 * Interactive mode if no arguments provided
 */

import * as sdk from 'matrix-js-sdk';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

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
let action: 'link' | 'unlink' | '' = '';

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--link':
    case '-l':
      action = 'link';
      break;
    case '--unlink':
    case '-u':
      action = 'unlink';
      break;
  }
}

const client = sdk.createClient({
  baseUrl: HOMESERVER_URL,
  accessToken: ACCESS_TOKEN,
  userId: USER_ID,
});

async function main() {
  console.log('=== Link Room to Space ===\n');

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

  if (spaces.length === 0) {
    console.error('No spaces found. Create a space first with create-space.ts');
    process.exit(1);
  }

  // Select action
  if (!action) {
    console.log('Actions:');
    console.log('  1. Link room to space');
    console.log('  2. Unlink room from space');
    console.log('');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const choice = await new Promise<string>((resolve) => {
      rl.question('Select [1/2]: ', resolve);
    });
    rl.close();

    action = choice.trim() === '2' ? 'unlink' : 'link';
  }

  // Select space
  console.log('\nSelect space:\n');
  spaces.forEach((s, i) => {
    console.log(`  [${i + 1}] ${s.name} (${s.roomId})`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const spaceChoice = await new Promise<string>((resolve) => {
    rl.question('\nEnter number: ', resolve);
  });

  const spaceIdx = parseInt(spaceChoice.trim()) - 1;
  if (spaceIdx < 0 || spaceIdx >= spaces.length) {
    console.error('Invalid selection');
    rl.close();
    process.exit(1);
  }

  const selectedSpace = spaces[spaceIdx];

  // Get already linked rooms
  const children = selectedSpace.currentState.getStateEvents('m.space.child') || [];
  const linkedRoomIds = new Set<string>();
  children.forEach((c) => {
    linkedRoomIds.add(c.getStateKey());
  });

  // Select room
  console.log(`\n${action === 'link' ? 'Available' : 'Linked'} rooms:\n`);

  if (action === 'link') {
    const availableRooms = regularRooms.filter((r) => !linkedRoomIds.has(r.roomId));
    availableRooms.forEach((r, i) => {
      console.log(`  [${i + 1}] ${r.name || '(unnamed)'} (${r.roomId})`);
    });

    if (availableRooms.length === 0) {
      console.log('  (All rooms are already linked)');
      rl.close();
      process.exit(0);
    }

    const roomChoice = await new Promise<string>((resolve) => {
      rl.question('\nEnter number: ', resolve);
    });

    const roomIdx = parseInt(roomChoice.trim()) - 1;
    if (roomIdx < 0 || roomIdx >= availableRooms.length) {
      console.error('Invalid selection');
      rl.close();
      process.exit(1);
    }

    const selectedRoom = availableRooms[roomIdx];

    // Ask about suggested
    const suggestedChoice = await new Promise<string>((resolve) => {
      rl.question('Show as suggested in space? [y/N]: ', resolve);
    });
    const suggested = suggestedChoice.trim().toLowerCase() === 'y';

    console.log(`\nLinking ${selectedRoom.name} to ${selectedSpace.name}...`);

    try {
      // Add child to space
      await client.sendStateEvent(selectedSpace.roomId, 'm.space.child', { via: [HOMESERVER_URL.replace(/^https?:\/\//, '')], suggested }, selectedRoom.roomId);

      // Add parent to room
      await client.sendStateEvent(selectedRoom.roomId, 'm.space.parent', { via: [HOMESERVER_URL.replace(/^https?:\/\//, '')], suggested }, selectedSpace.roomId);

      console.log('✓ Room linked successfully!');
      console.log(`  Room: ${selectedRoom.name}`);
      console.log(`  Space: ${selectedSpace.name}`);
      if (suggested) {
        console.log('  (Shown as suggested in space)');
      }
    } catch (err) {
      console.error('✗ Failed:', (err as Error).message);
      rl.close();
      process.exit(1);
    }
  } else {
    // Unlink
    const linkedRooms = regularRooms.filter((r) => linkedRoomIds.has(r.roomId));

    if (linkedRooms.length === 0) {
      console.log('  (No linked rooms)');
      rl.close();
      process.exit(0);
    }

    linkedRooms.forEach((r, i) => {
      console.log(`  [${i + 1}] ${r.name || '(unnamed)'} (${r.roomId})`);
    });

    const roomChoice = await new Promise<string>((resolve) => {
      rl.question('\nEnter number to unlink: ', resolve);
    });

    const roomIdx = parseInt(roomChoice.trim()) - 1;
    if (roomIdx < 0 || roomIdx >= linkedRooms.length) {
      console.error('Invalid selection');
      rl.close();
      process.exit(1);
    }

    const selectedRoom = linkedRooms[roomIdx];

    console.log(`\nUnlinking ${selectedRoom.name} from ${selectedSpace.name}...`);

    try {
      // Remove child from space
      await client.sendStateEvent(selectedSpace.roomId, 'm.space.child', {}, selectedRoom.roomId);

      // Remove parent from room
      await client.sendStateEvent(selectedRoom.roomId, 'm.space.parent', {}, selectedSpace.roomId);

      console.log('✓ Room unlinked successfully!');
    } catch (err) {
      console.error('✗ Failed:', (err as Error).message);
      rl.close();
      process.exit(1);
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

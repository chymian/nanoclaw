#!/usr/bin/env tsx
/**
 * List all rooms in a Matrix space with visibility and member info
 *
 * Usage:
 *   # Option 1: Set env vars directly
 *   export MATRIX_HOMESERVER_URL="https://your-server.com"
 *   export MATRIX_ACCESS_TOKEN="syt_..."
 *   export MATRIX_USER_ID="@user:server.com"
 *   export MATRIX_SPACE_ID="!space:server.com"  # Optional, uses first space found
 *
 *   # Option 2: Create .env file in current directory or project root
 *   cat > .env << EOF
 *   MATRIX_HOMESERVER_URL="https://your-server.com"
 *   MATRIX_ACCESS_TOKEN="syt_..."
 *   MATRIX_USER_ID="@user:server.com"
 *   EOF
 *
 *   npx tsx list-rooms.ts
 */

import * as sdk from 'matrix-js-sdk';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Try to load .env from multiple locations
const possibleEnvPaths = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '..', '..', '.env'), // From skill to project root
  path.join(__dirname, '.env'),
];

let envLoaded = false;
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    config({ path: envPath });
    envLoaded = true;
    break;
  }
}

const HOMESERVER_URL = process.env.MATRIX_HOMESERVER_URL!;
const ACCESS_TOKEN = process.env.MATRIX_ACCESS_TOKEN!;
const USER_ID = process.env.MATRIX_USER_ID!;

if (!HOMESERVER_URL || !ACCESS_TOKEN || !USER_ID) {
  console.error('Error: MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN, and MATRIX_USER_ID required');
  console.error('');
  console.error('Set them as environment variables or create a .env file with:');
  console.error('  MATRIX_HOMESERVER_URL="https://your-server.com"');
  console.error('  MATRIX_ACCESS_TOKEN="syt_..."');
  console.error('  MATRIX_USER_ID="@user:server.com"');
  if (!envLoaded) {
    console.error('');
    console.error('(No .env file found in: ' + possibleEnvPaths.join(', ') + ')');
  }
  process.exit(1);
}

const client = sdk.createClient({
  baseUrl: HOMESERVER_URL,
  accessToken: ACCESS_TOKEN,
  userId: USER_ID,
});

async function main() {
  console.log('Connecting to Matrix...');
  await client.startClient({ initialSyncLimit: 0 });

  await new Promise<void>((resolve) => {
    client.once(sdk.ClientEvent.Sync, (state) => {
      if (state === sdk.SyncState.Prepared) resolve();
    });
  });

  const rooms = client.getRooms();
  console.log(`\n=== All Joined Rooms (${rooms.length}) ===\n`);

  // Find spaces
  const spaces = rooms.filter(r => {
    const typeEvent = r.currentState.getStateEvents('m.room.type', '');
    return typeEvent?.getContent()?.type === 'm.space';
  });

  // Get target space
  let targetSpace = process.env.MATRIX_SPACE_ID
    ? rooms.find(r => r.roomId === process.env.MATRIX_SPACE_ID)
    : spaces[0];

  if (!targetSpace && spaces.length > 0) {
    targetSpace = spaces[0];
  }

  // List spaces
  console.log(`Spaces found: ${spaces.length}`);
  for (const space of spaces) {
    const isTarget = space.roomId === targetSpace?.roomId;
    console.log(`  ${isTarget ? '▶' : ' '} ${space.name} (${space.roomId})`);
  }
  console.log('');

  if (!targetSpace) {
    console.log('No space found. Listing all rooms:\n');
  } else {
    console.log(`=== Rooms in "${targetSpace.name}" ===\n`);

    // Get child rooms
    const children = targetSpace.currentState.getStateEvents('m.space.child');
    const childIds = new Set<string>();
    if (children) {
      for (const child of children) {
        const roomId = child.getStateKey();
        if (roomId) childIds.add(roomId);
      }
    }

    // Filter to space rooms
    const spaceRooms = rooms.filter(r => childIds.has(r.roomId));

    console.log(`Space-linked rooms: ${spaceRooms.length}\n`);

    for (const room of spaceRooms) {
      // Get join rules
      const joinRules = room.currentState.getStateEvents('m.room.join_rules', '');
      const joinRule = joinRules?.getContent()?.join_rule || 'unknown';

      // Translate join rule to visibility
      let visibility = 'unknown';
      switch (joinRule) {
        case 'public':
          visibility = '🌐 Public';
          break;
        case 'invite':
          visibility = '🔒 Invite only';
          break;
        case 'restricted':
          visibility = '👥 Space members';
          break;
        case 'knock':
          visibility = '🚪 Knock to join';
          break;
        default:
          visibility = `❓ ${joinRule}`;
      }

      // Get members
      const memberCount = room.getJoinedMemberCount();
      const memberIcon = memberCount === 1 ? '👤' : '👥';

      console.log(`${visibility.padEnd(20)} ${memberIcon} ${String(memberCount).padStart(2)} members  ${room.name || '(unnamed)'}`);
      console.log(`                     Room ID: ${room.roomId}`);

      // Check for restricted allow list
      if (joinRule === 'restricted') {
        const allow = joinRules?.getContent()?.allow || [];
        if (allow.length > 0) {
          console.log(`                     Allowed spaces:`);
          for (const rule of allow) {
            if (rule.type === 'm.room_membership') {
              console.log(`                       - ${rule.room_id}`);
            }
          }
        }
      }
      console.log('');
    }
  }

  // Also list rooms not in any space
  const unlinkedRooms = rooms.filter(r => {
    const parents = r.currentState.getStateEvents('m.space.parent');
    return !parents || parents.length === 0;
  });

  if (unlinkedRooms.length > 0) {
    console.log(`\n=== Rooms not in any space (${unlinkedRooms.length}) ===\n`);
    for (const room of unlinkedRooms) {
      const joinRules = room.currentState.getStateEvents('m.room.join_rules', '');
      const joinRule = joinRules?.getContent()?.join_rule || '?';
      console.log(`  ${room.name || '(unnamed)'} [${joinRule}] - ${room.roomId}`);
    }
  }

  client.stopClient();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

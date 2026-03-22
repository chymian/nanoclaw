#!/usr/bin/env tsx
/**
 * List all rooms in a Matrix space with visibility and member info
 *
 * Usage:
 *   npx tsx list-rooms.ts [--all] [--space <id>] [--compact]
 *
 * Examples:
 *   # List all rooms with their space membership (human-readable)
 *   npx tsx list-rooms.ts --all
 *
 *   # List rooms in a specific space (interactive picker if no space given)
 *   npx tsx list-rooms.ts --space "!space:id"
 *
 *   # Compact output for pipes (TSV format)
 *   npx tsx list-rooms.ts --all --compact | grep restricted
 */

import * as sdk from 'matrix-js-sdk';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Parse args
const args = process.argv.slice(2);
const showAll = args.includes('--all') || args.includes('-a');
const isCompact = args.includes('--compact') || args.includes('-c');
const isPipe = !process.stdout.isTTY;

let targetSpaceId = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--space' || args[i] === '-s') {
    targetSpaceId = args[i + 1] || '';
  }
}

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

function getRoomType(room: sdk.Room): 'space' | 'room' {
  const createEvent = room.currentState.getStateEvents('m.room.create', '');
  const createType = createEvent?.getContent()?.type;
  if (createType === 'm.space') return 'space';
  // Fallback for legacy spaces that use m.room.type
  const typeEvent = room.currentState.getStateEvents('m.room.type', '');
  if (typeEvent?.getContent()?.type === 'm.space') return 'space';
  return 'room';
}

function getJoinRule(room: sdk.Room): string {
  const joinRules = room.currentState.getStateEvents('m.room.join_rules', '');
  return joinRules?.getContent()?.join_rule || 'unknown';
}

function getParentSpaces(room: sdk.Room, allSpaces: sdk.Room[]): sdk.Room[] {
  const parents: sdk.Room[] = [];
  for (const space of allSpaces) {
    const children = space.currentState.getStateEvents('m.space.child') || [];
    for (const child of children) {
      const childRoomId = child.getStateKey();
      if (childRoomId === room.roomId && Object.keys(child.getContent()).length > 0) {
        parents.push(space);
        break;
      }
    }
  }
  return parents;
}

async function main() {
  if (!isPipe) {
    console.log('Connecting to Matrix...');
  }
  await client.startClient({ initialSyncLimit: 0 });
  await new Promise<void>((resolve) => {
    client.once(sdk.ClientEvent.Sync, (state) => {
      if (state === sdk.SyncState.Prepared) resolve();
    });
  });

  const rooms = client.getRooms();
  const spaces = rooms.filter(r => getRoomType(r) === 'space');
  const regularRooms = rooms.filter(r => getRoomType(r) === 'room');

  // Mode 1: --all flag or pipe mode without --space - show all rooms with space membership
  if (showAll || (isPipe && !targetSpaceId)) {
    if (isCompact || isPipe) {
      // TSV format: room_id\tname\tspace_names\tspace_ids\tmembers\tjoin_rule
      console.log('room_id\troom_name\tspace_names\tspace_ids\tmembers\tjoin_rule');
      for (const room of regularRooms) {
        const parents = getParentSpaces(room, spaces);
        const parentNames = parents.map(s => s.name).join(',') || '(none)';
        const parentIds = parents.map(s => s.roomId).join(',') || '';
        const memberCount = room.getJoinedMemberCount();
        const joinRule = getJoinRule(room);
        console.log(`${room.roomId}\t${room.name || '(unnamed)'}\t${parentNames}\t${parentIds}\t${memberCount}\t${joinRule}`);
      }
    } else {
      // Human-readable table
      console.log(`\n=== All Rooms (${regularRooms.length}) with Space Membership ===\n`);
      console.log('Room Name                    | Space Membership     | Members | Join Rule');
      console.log('-----------------------------+----------------------+---------+----------');
      for (const room of regularRooms) {
        const parents = getParentSpaces(room, spaces);
        const parentNames = parents.map(s => s.name).join(', ') || '-';
        const memberCount = room.getJoinedMemberCount();
        const joinRule = getJoinRule(room);
        const name = (room.name || '(unnamed)').substring(0, 28).padEnd(28);
        const spaceNames = parentNames.substring(0, 20).padEnd(20);
        console.log(`${name} | ${spaceNames} | ${String(memberCount).padStart(7)} | ${joinRule}`);
      }
    }
    client.stopClient();
    console.log('');
    return;
  }

  // Mode 2: Specific space requested via --space
  let targetSpace: sdk.Room | undefined;
  if (targetSpaceId) {
    targetSpace = spaces.find(s => s.roomId === targetSpaceId);
    if (!targetSpace) {
      console.error(`Space not found: ${targetSpaceId}`);
      console.error(`Available spaces: ${spaces.map(s => s.name).join(', ')}`);
      client.stopClient();
      process.exit(1);
    }
  }

  // Mode 3: Interactive space picker (TTY only)
  if (!targetSpace && spaces.length > 0 && !isPipe) {
    console.log(`\n=== Select a Space (${spaces.length} available) ===\n`);
    spaces.forEach((s, i) => {
      console.log(`  [${i + 1}] ${s.name} (${s.getJoinedMemberCount()} members)`);
    });
    console.log('');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const choice = await new Promise<string>((resolve) => {
      rl.question('Enter space number: ', resolve);
    });
    rl.close();

    const idx = parseInt(choice.trim()) - 1;
    if (idx >= 0 && idx < spaces.length) {
      targetSpace = spaces[idx];
    } else {
      console.error('Invalid selection');
      client.stopClient();
      process.exit(1);
    }
  }

  // Show rooms for selected space
  if (targetSpace) {
    // Get child rooms from space
    const children = targetSpace.currentState.getStateEvents('m.space.child');
    const childIds = new Set<string>();
    if (children) {
      for (const child of children) {
        const roomId = child.getStateKey();
        if (roomId && Object.keys(child.getContent()).length > 0) {
          childIds.add(roomId);
        }
      }
    }

    // Get rooms linked to this space
    const linkedRooms = regularRooms.filter(r => childIds.has(r.roomId));

    if (isCompact || isPipe) {
      // Compact mode: room_id name members join_rule
      for (const room of linkedRooms) {
        console.log(`${room.roomId}\t${room.name || '(unnamed)'}\t${room.getJoinedMemberCount()}\t${getJoinRule(room)}`);
      }
    } else {
      console.log(`\n=== Rooms in "${targetSpace.name}" (${linkedRooms.length}) ===\n`);
      for (const room of linkedRooms) {
        const joinRule = getJoinRule(room);
        const memberCount = room.getJoinedMemberCount();
        const visibility = joinRule === 'restricted' ? '👥 Space members' :
                          joinRule === 'public' ? '🌐 Public' :
                          joinRule === 'invite' ? '🔒 Invite only' : joinRule;
        console.log(`  ${room.name || '(unnamed)'} [${visibility}, ${memberCount} members]`);
        console.log(`  Room ID: ${room.roomId}`);

        // Check for restricted allow list
        if (joinRule === 'restricted') {
          const joinRules = room.currentState.getStateEvents('m.room.join_rules', '');
          const allow = joinRules?.getContent()?.allow || [];
          if (allow.length > 0) {
            console.log(`    Allowed spaces:`);
            for (const rule of allow) {
              if (rule.type === 'm.room_membership') {
                console.log(`      - ${rule.room_id}`);
              }
            }
          }
        }
        console.log('');
      }
    }
  } else {
    console.log('No spaces found and no specific room requested.');
  }

  client.stopClient();
  if (!isCompact && !isPipe) console.log('');
}

main().catch(err => {
  console.error('Error:', err.message);
  client.stopClient();
  process.exit(1);
});

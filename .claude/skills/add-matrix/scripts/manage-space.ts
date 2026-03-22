#!/usr/bin/env tsx
/**
 * Manage Matrix Space members - kick, ban, unban, promote/demote
 *
 * Usage:
 *   npx tsx manage-space.ts --space "!space:server.com" [--action kick|ban|unban|promote|demote] [--user @user:server.com]
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
let action: 'kick' | 'ban' | 'unban' | 'promote' | 'demote' | '' = '';
let targetUser = '';
let reason = '';

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--room':
    case '-r':
      targetRoom = args[++i] || '';
      break;
    case '--space':
    case '-s':
      targetRoom = args[++i] || '';
      break;
    case '--action':
    case '-a':
      action = args[++i] as typeof action;
      break;
    case '--user':
    case '-u':
      targetUser = args[++i] || '';
      break;
    case '--reason':
      reason = args[++i] || '';
      break;
  }
}

const client = sdk.createClient({
  baseUrl: HOMESERVER_URL,
  accessToken: ACCESS_TOKEN,
  userId: USER_ID,
});

async function main() {
  console.log('=== Matrix Space/Room Management ===\n');

  await client.startClient({ initialSyncLimit: 0 });
  await new Promise<void>((resolve) => {
    client.once(sdk.ClientEvent.Sync, (state) => {
      if (state === sdk.SyncState.Prepared) resolve();
    });
  });

  // Select target room/space
  if (!targetRoom) {
    const rooms = client.getRooms();
    const spaces = rooms.filter((r) => {
      const typeEvent = r.currentState.getStateEvents('m.room.type', '');
      return typeEvent?.getContent()?.type === 'm.space';
    });

    console.log('Select space/room to manage:\n');

    if (spaces.length > 0) {
      console.log('-- Spaces --');
      spaces.forEach((s, i) => {
        console.log(`  [S${i + 1}] ${s.name} (${s.getJoinedMemberCount()} members)`);
      });
      console.log('');
    }

    const regularRooms = rooms.filter((r) => !spaces.includes(r));
    console.log('-- Rooms --');
    regularRooms.slice(0, 10).forEach((r, i) => {
      console.log(`  [${i + 1}] ${r.name || '(unnamed)'} (${r.getJoinedMemberCount()} members)`);
    });
    if (regularRooms.length > 10) {
      console.log(`  ... and ${regularRooms.length - 10} more`);
    }
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
      }
    } else {
      const idx = parseInt(trimmed) - 1;
      if (idx >= 0 && idx < regularRooms.length) {
        targetRoom = regularRooms[idx].roomId;
      }
    }
  }

  if (!targetRoom) {
    console.error('No room selected');
    process.exit(1);
  }

  const room = client.getRoom(targetRoom);
  if (!room) {
    console.error('Room not found');
    process.exit(1);
  }

  const isSpace = room.currentState.getStateEvents('m.room.type', '')?.getContent()?.type === 'm.space';
  console.log(`\nManaging: ${room.name} (${isSpace ? 'Space' : 'Room'})\n`);

  // Get members
  const members = room.getJoinedMembers();
  const banned = room.currentState.getStateEvents('m.room.member').filter(
    (e: sdk.MatrixEvent) => e.getContent().membership === 'ban'
  );

  if (!action) {
    console.log('Current members:');
    members.forEach((m, i) => {
      const power = room.getMember(m.userId)?.powerLevel || 0;
      const powerLabel = power >= 100 ? ' [Admin]' : power >= 50 ? ' [Mod]' : '';
      console.log(`  [${i + 1}] ${m.name}${powerLabel} (${m.userId})`);
    });

    if (banned.length > 0) {
      console.log('\nBanned users:');
      banned.forEach((b: sdk.MatrixEvent) => {
        console.log(`  - ${b.getStateKey()} (${b.getContent().reason || 'no reason'})`);
      });
    }

    console.log('\nActions:');
    console.log('  1. Kick - Remove user (can rejoin if invited)');
    console.log('  2. Ban - Block user from joining');
    console.log('  3. Unban - Remove ban');
    console.log('  4. Promote - Give moderator/admin rights');
    console.log('  5. Demote - Remove moderator/admin rights');
    console.log('');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const choice = await new Promise<string>((resolve) => {
      rl.question('Select action [1-5]: ', resolve);
    });

    const actions: Record<string, typeof action> = {
      '1': 'kick',
      '2': 'ban',
      '3': 'unban',
      '4': 'promote',
      '5': 'demote',
    };
    action = actions[choice.trim()] || '';

    if (!action) {
      console.error('Invalid action');
      rl.close();
      process.exit(1);
    }

    // Select user
    const userChoice = await new Promise<string>((resolve) => {
      rl.question('Select user number: ', resolve);
    });

    const userIdx = parseInt(userChoice.trim()) - 1;
    if (userIdx < 0 || userIdx >= members.length) {
      console.error('Invalid user selection');
      rl.close();
      process.exit(1);
    }

    targetUser = members[userIdx].userId;

    if (action === 'kick' || action === 'ban') {
      const reasonInput = await new Promise<string>((resolve) => {
        rl.question('Reason (optional): ', resolve);
      });
      reason = reasonInput.trim();
    }

    rl.close();
  }

  if (!targetUser) {
    console.error('No user specified');
    process.exit(1);
  }

  // Execute action
  console.log(`\n${action.toUpperCase()} ${targetUser}...`);

  try {
    switch (action) {
      case 'kick':
        await client.kick(targetRoom, targetUser, reason);
        console.log('✓ User kicked successfully');
        break;

      case 'ban':
        await client.ban(targetRoom, targetUser, reason);
        console.log('✓ User banned successfully');
        break;

      case 'unban':
        await client.unban(targetRoom, targetUser);
        console.log('✓ User unbanned successfully');
        break;

      case 'promote':
        await client.setPowerLevel(targetRoom, targetUser, 50);
        console.log('✓ User promoted to moderator');
        break;

      case 'demote':
        await client.setPowerLevel(targetRoom, targetUser, 0);
        console.log('✓ User demoted to regular member');
        break;
    }
  } catch (err) {
    console.error('✗ Failed:', (err as Error).message);
    console.error('You may need admin/mod permissions in this room/space.');
    process.exit(1);
  }

  client.stopClient();
  console.log('');
}

main().catch((err) => {
  console.error('Error:', err.message);
  client.stopClient();
  process.exit(1);
});

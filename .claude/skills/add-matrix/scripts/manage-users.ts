#!/usr/bin/env tsx
/**
 * Manage Matrix users - invite/to links, kick, ban, unban, promote/demote
 * Works for both Spaces and Rooms
 *
 * Usage:
 *   npx tsx manage-users.ts --space "!space:server.com" [--action kick|ban|unban|promote|demote] [--user @user:server.com]
 *   npx tsx manage-users.ts --room "!room:server.com" [--action kick|ban|unban|promote|demote] [--user @user:server.com]
 *
 * Or create .env file with MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN, MATRIX_USER_ID
 */
import * as sdk from 'matrix-js-sdk';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
const __dirname = path.dirname(new URL(import.meta.url).pathname);
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
let targetRoom = '';
let isSpace = false;
let action: 'kick' | 'ban' | 'unban' | 'promote' | 'demote' | 'invite' | '' = '';
let targetUser = '';
let reason = '';
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--room':
    case '-r':
      targetRoom = args[++i] || '';
      isSpace = false;
      break;
    case '--space':
    case '-s':
      targetRoom = args[++i] || '';
      isSpace = true;
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
  console.log('=== Matrix User Management ===\n');
  await client.startClient({ initialSyncLimit: 0 });
  await new Promise<void>((resolve) => {
    client.once(sdk.ClientEvent.Sync, (state) => {
      if (state === sdk.SyncState.Prepared) resolve();
    });
  });
  if (!targetRoom) {
    const rooms = client.getRooms();
    const spaces = rooms.filter((r) => {
      const createEvent = r.currentState.getStateEvents('m.room.create', '');
      // Check both m.room.create type and legacy m.room.type
    const createType = createEvent?.getContent()?.type;
    if (createType === 'm.space') return true;
    // Fallback for legacy spaces that use m.room.type
    const typeEvent = r.currentState.getStateEvents('m.room.type', '');
    return typeEvent?.getContent()?.type === 'm.space';
    });
    const regularRooms = rooms.filter((r) => !spaces.includes(r));
    console.log('Select room or space to manage:\n');
    if (spaces.length > 0) {
      console.log('-- Spaces --');
      spaces.forEach((s, i) => {
        console.log(` [S${i + 1}] ${s.name} (${s.getJoinedMemberCount()} members)`);
      });
      console.log('');
    }
    console.log('-- Rooms --');
    regularRooms.forEach((r, i) => {
      console.log(` [${i + 1}] ${r.name || '(unnamed)'} (${r.getJoinedMemberCount()} members)`);
    });
    console.log('');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise<string>((resolve) => {
      rl.question('Enter number (S# for space): ', resolve);
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
        isSpace = false;
      }
    }
  }
  if (!targetRoom) {
    console.error('No room/space selected');
    process.exit(1);
  }
  const room = client.getRoom(targetRoom);
  if (!room) {
    console.error('Room/Space not found');
    process.exit(1);
  }
  const detectedIsSpace = room.currentState.getStateEvents('m.room.type', '')?.getContent()?.type === 'm.space';
  if (isSpace && !detectedIsSpace) {
    console.error('Warning: --space flag used but target is a regular room');
  } else if (!isSpace && detectedIsSpace) {
    console.log('Note: Target is a space');
    isSpace = true;
  }
  console.log(`\nManaging: ${room.name} (${isSpace ? 'Space' : 'Room'})\n`);
  // Get existing members
  const members = room.getJoinedMembers();
  const banned = room.currentState.getStateEvents('m.room.member').filter(
    (e: sdk.MatrixEvent) => e.getContent().membership === 'ban'
  );
  if (!action) {
    // Show current state
    console.log('Current members:');
    members.forEach((m, i) => {
      const power = room.getMember(m.userId)?.powerLevel || 0;
      const powerLabel = power >= 100 ? ' [Admin]' : power >= 50 ? ' [Mod]' : '';
      console.log(` [${i + 1}] ${m.name}${powerLabel} (${m.userId})`);
    });
    if (banned.length > 0) {
      console.log('\nBanned users:');
      banned.forEach((b: sdk.MatrixEvent) => {
        console.log(` - ${b.getStateKey()} (${b.getContent().reason || 'no reason'})`);
      });
    }
    console.log('\nActions:');
    console.log(' 1. Invite - Invite a new user');
    console.log(' 2. Kick - Remove user (can rejoin if invited)');
    console.log(' 3. Ban - Block user from joining');
    console.log(' 4. Unban - Remove ban');
    console.log(' 5. Promote - Give moderator/admin rights');
    console.log(' 6. Demote - Remove moderator/admin rights');
    console.log('');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const choice = await new Promise<string>((resolve) => {
      rl.question('Select action [1-6]: ', resolve);
    });
    const actions: Record<string, typeof action> = {
      '1': 'invite',
      '2': 'kick',
      '3': 'ban',
      '4': 'unban',
      '5': 'promote',
      '6': 'demote',
    };
    action = actions[choice.trim()] || '';
    if (!action) {
      console.error('Invalid action');
      rl.close();
      process.exit(1);
    }
    // For invite, ask for user ID directly
    if (action === 'invite') {
      const idInput = await new Promise<string>((resolve) => {
        rl.question('Matrix ID to invite (@user:server.com): ', resolve);
      });
      targetUser = idInput.trim();
    } else if (action === 'unban') {
      // For unban, show banned users
      const bannedList = banned.map((b: sdk.MatrixEvent) => b.getStateKey());
      if (bannedList.length === 0) {
        console.log('No banned users');
        rl.close();
        client.stopClient();
        return;
      }
      console.log('\nBanned users:');
      bannedList.forEach((userId: string | null, i: number) => {
        console.log(` [${i + 1}] ${userId}`);
      });
      const idInput = await new Promise<string>((resolve) => {
        rl.question('Enter banned user number: ', resolve);
      });
      const idx = parseInt(idInput.trim()) - 1;
      if (idx >= 0 && idx < bannedList.length) {
        targetUser = bannedList[idx] || '';
      }
    } else {
      // For other actions, select from members
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
    }
    if (action === 'kick' || action === 'ban') {
      const reasonInput = await new Promise<string>((resolve) => {
        rl.question('Reason (optional): ', resolve);
      });
      reason = reasonInput.trim();
    }
    rl.close();
  }
  if (!targetUser && action !== 'invite') {
    console.error('No user specified');
    process.exit(1);
  }
  // Execute action
  console.log(`\n${action.toUpperCase()} ${targetUser || ''}...`);
  try {
    switch (action) {
      case 'invite':
        if (!targetUser.match(/^@.+:.+$/)) {
          console.error('Invalid Matrix ID format. Should be @user:server.com');
          client.stopClient();
          process.exit(1);
        }
        await client.invite(targetRoom, targetUser);
        console.log('✓ User invited successfully');
        break;
      case 'kick':
        if (!targetUser) throw new Error('Target user required');
        await client.kick(targetRoom, targetUser, reason);
        console.log('✓ User kicked successfully');
        break;
      case 'ban':
        if (!targetUser) throw new Error('Target user required');
        await client.ban(targetRoom, targetUser, reason);
        console.log('✓ User banned successfully');
        break;
      case 'unban':
        if (!targetUser) throw new Error('Target user required');
        await client.unban(targetRoom, targetUser);
        console.log('✓ User unbanned successfully');
        break;
      case 'promote':
        if (!targetUser) throw new Error('Target user required');
        await client.setPowerLevel(targetRoom, targetUser, 50);
        console.log('✓ User promoted to moderator');
        break;
      case 'demote':
        if (!targetUser) throw new Error('Target user required');
        await client.setPowerLevel(targetRoom, targetUser, 0);
        console.log('✓ User demoted to regular member');
        break;
    }
    if (action === 'invite' && isSpace) {
      console.log('\nNote: Space membership does NOT automatically grant access to linked rooms.');
      console.log('      Users must be invited to rooms separately or rooms must have restricted join rules.');
    }
  } catch (err) {
    console.error('✗ Failed:', (err as Error).message);
    console.error('You may need admin/mod permissions in this room/space.');
    client.stopClient();
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

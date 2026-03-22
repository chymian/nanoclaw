#!/usr/bin/env tsx
/**
 * Delete/leave a Matrix Room
 *
 * Usage:
 * npx tsx delete-room.ts [--room "!room:server.com"]
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
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--room':
    case '-r':
      targetRoom = args[++i] || '';
      break;
  }
}
const client = sdk.createClient({
  baseUrl: HOMESERVER_URL,
  accessToken: ACCESS_TOKEN,
  userId: USER_ID,
});
async function main() {
  console.log('=== Delete Matrix Room ===\n');
  await client.startClient({ initialSyncLimit: 0 });
  await new Promise<void>((resolve) => {
    client.once(sdk.ClientEvent.Sync, (state) => {
      if (state === sdk.SyncState.Prepared) resolve();
    });
  });
  // Select room
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
    if (regularRooms.length === 0) {
      console.log('No regular rooms found.\n');
      client.stopClient();
      return;
    }
    console.log('Select room to delete/leave:\n');
    regularRooms.forEach((r, i) => {
      console.log(` [${i + 1}] ${r.name || '(unnamed)'} (${r.getJoinedMemberCount()} members)`);
    });
    console.log('');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const choice = await new Promise<string>((resolve) => {
      rl.question('Enter number: ', resolve);
    });
    const idx = parseInt(choice.trim()) - 1;
    rl.close();
    if (idx < 0 || idx >= regularRooms.length) {
      console.error('Invalid selection');
      client.stopClient();
      process.exit(1);
    }
    targetRoom = regularRooms[idx].roomId;
  }
  const room = client.getRoom(targetRoom);
  if (!room) {
    console.error('Room not found');
    client.stopClient();
    process.exit(1);
  }
  // Check if it's actually a space
  const isSpace = room.currentState.getStateEvents('m.room.type', '')?.getContent()?.type === 'm.space';
  if (isSpace) {
    console.error('This is a space, not a room. Use delete-space.ts instead.');
    client.stopClient();
    process.exit(1);
  }
  console.log(`\n⚠️  Warning: You are about to leave:"${room.name || '(unnamed)'}"`);
  console.log(`    This will remove you from the room.`);
  console.log(`    Other members will still see the room.\n`);
  const memberCount = room.getJoinedMemberCount();
  console.log(`Room details:`);
  console.log(`  • Members: ${memberCount}`);
  console.log(`  • Your ID: ${USER_ID}`);
  console.log('');
  if (memberCount <= 2) {
    console.log('⚠️  You appear to be the only member or one of few.');
    console.log('   If you leave, the room will be empty/frozen.\n');
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const confirm = await new Promise<string>((resolve) => {
    rl.question('Type "LEAVE" to confirm (or empty to cancel): ', resolve);
  });
  rl.close();
  if (confirm.trim() !== 'LEAVE') {
    console.log('\n✗ Cancelled.\n');
    client.stopClient();
    return;
  }
  console.log(`\nLeaving ${room.name || 'room'}...`);
  try {
    await client.leave(targetRoom);
    console.log('✓ Left room successfully!');
  } catch (err) {
    console.error('✗ Failed:', (err as Error).message);
    client.stopClient();
    process.exit(1);
  }
  // Optionally forget room
  const rl2 = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const forgetChoice = await new Promise<string>((resolve) => {
    rl2.question('\nForget room (remove from room list)? [y/N]: ', resolve);
  });
  rl2.close();
  if (forgetChoice.trim().toLowerCase() === 'y') {
    try {
      await client.forget(targetRoom);
      console.log('✓ Room forgotten');
    } catch (err) {
      console.log('⚠️  Could not forget room:', (err as Error).message);
    }
  }
  // Also unregister from NanoClaw if stored
  const envLocal = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envLocal)) {
    const content = fs.readFileSync(envLocal, 'utf-8');
    if (content.includes(targetRoom)) {
      console.log('\nNote: This room may be registered with NanoClaw.');
      console.log('      Run: npx tsx setup/index.ts --step register-group');
      console.log('      to update registered groups.\n');
    }
  }
  client.stopClient();
  console.log('');
}
main().catch((err) => {
  console.error('Error:', err.message);
  client.stopClient();
  process.exit(1);
});

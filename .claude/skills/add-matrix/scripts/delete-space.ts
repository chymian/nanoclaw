#!/usr/bin/env tsx
/**
 * Delete a Matrix Space
 *
 * Usage:
 * npx tsx delete-space.ts [--space "!space:server.com"]
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
let targetSpace = '';
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--space':
    case '-s':
      targetSpace = args[++i] || '';
      break;
  }
}
const client = sdk.createClient({
  baseUrl: HOMESERVER_URL,
  accessToken: ACCESS_TOKEN,
  userId: USER_ID,
});
async function main() {
  console.log('=== Delete Matrix Space ===\n');
  await client.startClient({ initialSyncLimit: 0 });
  await new Promise<void>((resolve) => {
    client.once(sdk.ClientEvent.Sync, (state) => {
      if (state === sdk.SyncState.Prepared) resolve();
    });
  });
  // Select space
  if (!targetSpace) {
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
    if (spaces.length === 0) {
      console.log('No spaces found.\n');
      client.stopClient();
      return;
    }
    console.log('Select space to delete:\n');
    spaces.forEach((s, i) => {
      console.log(` [${i + 1}] ${s.name} (${s.getJoinedMemberCount()} members)`);
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
    if (idx < 0 || idx >= spaces.length) {
      console.error('Invalid selection');
      client.stopClient();
      process.exit(1);
    }
    targetSpace = spaces[idx].roomId;
  }
  const space = client.getRoom(targetSpace);
  if (!space) {
    console.error('Space not found');
    client.stopClient();
    process.exit(1);
  }
  // Check if it's actually a space
  const isSpace =
    space.currentState.getStateEvents('m.room.type', '')?.getContent()?.type === 'm.space';
  if (!isSpace) {
    console.error('This is a room, not a space. Use delete-room.ts instead.');
    client.stopClient();
    process.exit(1);
  }
  console.log(`\n⚠️  Warning: You are about to delete:"${space.name}"`);
  console.log(`    This will leave the space and you will lose admin access.`);
  console.log(`    Members will still see "!${space.name.split(' ')[0]}!... left the space".\n`);
  // Check for linked rooms
  const children = space.currentState.getStateEvents('m.space.child') || [];
  const linkedRooms = children.filter(
    (c: sdk.MatrixEvent) => Object.keys(c.getContent()).length > 0
  );
  if (linkedRooms.length > 0) {
    console.log(`⚠️  ${linkedRooms.length} room(s) are still linked to this space.`);
    console.log(`    They should be unlinked or deleted first.\n`);
    console.log('Linked rooms:');
    linkedRooms.forEach((room: sdk.MatrixEvent) => {
      const roomId = room.getStateKey();
      const childRoom = client.getRoom(roomId);
      console.log(`  • ${childRoom?.name || '(unnamed)'} (${roomId})`);
    });
    console.log('');
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const confirm = await new Promise<string>((resolve) => {
    rl.question('Type "DELETE" to confirm: ', resolve);
  });
  rl.close();
  if (confirm.trim() !== 'DELETE') {
    console.log('\n✗ Cancelled.\n');
    client.stopClient();
    return;
  }
  console.log(`\nLeaving ${space.name}...`);
  try {
    await client.leave(targetSpace);
    console.log('✓ Left space successfully!');
    console.log('  Note: The space may still exist if other admins are present.');
    console.log('        To completely remove it, all members must leave.');
  } catch (err) {
    console.error('✗ Failed:', (err as Error).message);
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

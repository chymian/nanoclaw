#!/usr/bin/env tsx
/**
 * List all Matrix Spaces and their details
 *
 * Usage:
 * npx tsx list-spaces.ts
 *
 * Or create .env file with MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN, MATRIX_USER_ID
 */
import * as sdk from 'matrix-js-sdk';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
const __dirname = path.dirname(new URL(import.meta.url).pathname);
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
const client = sdk.createClient({
  baseUrl: HOMESERVER_URL,
  accessToken: ACCESS_TOKEN,
  userId: USER_ID,
});
async function main() {
  console.log('=== Matrix Spaces ===\n');
  await client.startClient({ initialSyncLimit: 0 });
  await new Promise<void>((resolve) => {
    client.once(sdk.ClientEvent.Sync, (state) => {
      if (state === sdk.SyncState.Prepared) resolve();
    });
  });
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
  console.log(`Found ${spaces.length} space(s):\n`);
  spaces.forEach((space, index) => {
    const powerLevels = space.currentState.getStateEvents('m.room.power_levels', '');
    const joinRules = space.currentState.getStateEvents('m.room.join_rules', '');
    const joinRule = joinRules?.getContent()?.join_rule || 'unknown';
    const myPower = powerLevels?.getContent()?.users?.[USER_ID] || 0;
    const isAdmin = myPower >= 100;
    // Get child rooms
    const children = space.currentState.getStateEvents('m.space.child') || [];
    const linkedRooms = children.filter(
      (c: sdk.MatrixEvent) => Object.keys(c.getContent()).length > 0
    );
    console.log(`${index + 1}. ${space.name}`);
    console.log(`   ID: ${space.roomId}`);
    console.log(`   Members: ${space.getJoinedMemberCount()}`);
    console.log(`   Visibility: ${joinRule}`);
    console.log(`   Your role: ${isAdmin ? 'Admin' : myPower >= 50 ? 'Moderator' : 'Member'}`);
    console.log(`   Linked rooms: ${linkedRooms.length}`);
    if (linkedRooms.length > 0) {
      linkedRooms.forEach((room: sdk.MatrixEvent) => {
        const roomId = room.getStateKey();
        const childRoom = client.getRoom(roomId);
        if (childRoom) {
          const suggested = room.getContent().suggested ? ' [suggested]' : '';
          console.log(`      • ${childRoom.name || '(unnamed)'} (${roomId})${suggested}`);
        }
      });
    }
    console.log('');
  });
  client.stopClient();
}
main().catch((err) => {
  console.error('Error:', err.message);
  client.stopClient();
  process.exit(1);
});

#!/usr/bin/env tsx
/**
 * Create a Matrix Room with configuration options
 *
 * Usage:
 * npx tsx create-room.ts --name "My Room" [--type private|public|restricted] [--space "!space:server.com"]
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
let roomName = '';
let roomType: 'private' | 'public' | 'restricted' = 'private';
let parentSpace = '';
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--name':
    case '-n':
      roomName = args[++i] || '';
      break;
    case '--type':
    case '-t':
      const typeArg = args[++i] as typeof roomType;
      if (['private', 'public', 'restricted'].includes(typeArg)) {
        roomType = typeArg;
      }
      break;
    case '--space':
    case '-s':
      parentSpace = args[++i] || '';
      break;
  }
}
const client = sdk.createClient({
  baseUrl: HOMESERVER_URL,
  accessToken: ACCESS_TOKEN,
  userId: USER_ID,
});
async function main() {
  console.log('=== Create Matrix Room ===\n');
  await client.startClient({ initialSyncLimit: 0 });
  await new Promise<void>((resolve) => {
    client.once(sdk.ClientEvent.Sync, (state) => {
      if (state === sdk.SyncState.Prepared) resolve();
    });
  });
  // Get available spaces for restricted rooms
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
  // Interactive mode for name
  if (!roomName) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const askName = () =>
      new Promise<string>((resolve) => {
        rl.question('Room name: ', (answer: string) => resolve(answer.trim()));
      });
    roomName = await askName();
    while (!roomName) {
      console.log('Name is required');
      roomName = await askName();
    }
    // Ask for room type
    console.log('\nRoom types:');
    console.log(' private - Invite only (default)');
    console.log(' public - Anyone can join');
    console.log(' restricted - Space members can join without invite');
    console.log('');
    const askType = () =>
      new Promise<typeof roomType>((resolve) => {
        rl.question('Type [private/public/restricted]: ', (answer: string) => {
          const type = (answer.trim().toLowerCase() || 'private') as typeof roomType;
          if (['private', 'public', 'restricted'].includes(type)) {
            resolve(type);
          } else {
            console.log('Invalid type, using "private"');
            resolve('private');
          }
        });
      });
    roomType = await askType();
    // Ask if they want to link to a space
    if (spaces.length > 0 && roomType === 'restricted') {
      console.log('\nAvailable spaces:');
      spaces.forEach((s, i) => {
        console.log(` [${i + 1}] ${s.name}`);
      });
      console.log(' [0] None');
      const askSpace = () =>
        new Promise<string>((resolve) => {
          rl.question('\nLink to space (number or 0): ', resolve);
        });
      const spaceChoice = await askSpace();
      const spaceIdx = parseInt(spaceChoice.trim()) - 1;
      if (spaceIdx >= 0 && spaceIdx < spaces.length) {
        parentSpace = spaces[spaceIdx].roomId;
      }
    }
    rl.close();
  }
  await createRoom();
}
async function createRoom() {
  console.log(`\nCreating "${roomName}" room (${roomType})...\n`);
  // Determine join rules based on type
  let joinRule: string;
  let preset: sdk.Preset;
  let visibility: sdk.Visibility;
  switch (roomType) {
    case 'public':
      joinRule = 'public';
      preset = sdk.Preset.PublicChat;
      visibility = sdk.Visibility.Public;
      break;
    case 'restricted':
      joinRule = 'restricted';
      preset = sdk.Preset.PrivateChat;
      visibility = sdk.Visibility.Private;
      break;
    case 'private':
    default:
      joinRule = 'invite';
      preset = sdk.Preset.PrivateChat;
      visibility = sdk.Visibility.Private;
      break;
  }
  // Build initial_state
  const initialState: sdk.IEvent[] = [
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
        },
        events_default: 0,
        state_default: 50,
        ban: 50,
        kick: 50,
        redact: 50,
        invite: 50,
      },
      state_key: '',
    },
  ];
  // Add restricted join rules if applicable
  if (roomType === 'restricted' && parentSpace) {
    initialState[0].content = {
      join_rule: 'restricted',
      allow: [
        {
          type: 'm.room_membership',
          room_id: parentSpace,
        },
      ],
    };
  } else if (roomType === 'restricted' && !parentSpace) {
    console.log('⚠️  Restricted rooms require a parent space for access control.');
    console.log('   Continuing with invite-only settings...\n');
  }
  try {
    const { room_id } = await client.createRoom({
      name: roomName,
      room_version: '10',
      preset: preset,
      visibility: visibility,
      initial_state: initialState,
    });
    console.log('✓ Room created successfully!');
    console.log(` Room ID: ${room_id}`);
    console.log(` Name: ${roomName}`);
    console.log(` Type: ${roomType}`);
    console.log(` Join Rule: ${joinRule}`);
    // Link to space if specified
    if (parentSpace) {
      console.log('\nLinking to space...');
      try {
        const serverName = HOMESERVER_URL.replace(/^https?:\/\//, '');
        await client.sendStateEvent(
          parentSpace,
          'm.space.child',
          { via: [serverName], suggested: true },
          room_id,
        );
        await client.sendStateEvent(
          room_id,
          'm.space.parent',
          { via: [serverName], suggested: true },
          parentSpace,
        );
        console.log('✓ Linked to space successfully!');
      } catch (err) {
        console.log('⚠️  Could not link to space:', (err as Error).message);
        console.log('   Room was created but not linked. Use link-room-to-space.ts manually.');
      }
    }
    console.log('\nNext steps:');
    console.log(' 1. Invite members with: npx tsx manage-users.ts --room');
    console.log(' 2. Manage room with: npx tsx manage-users.ts --room');
    // Save to .env.local for easy reference
    const envLocal = path.join(process.cwd(), '.env.local');
    fs.appendFileSync(envLocal, `\n# Created room:\n# MATRIX_ROOM_ID="${room_id}"\n`, { flag: 'a' });
    console.log(`\nRoom ID saved to .env.local`);
  } catch (err) {
    console.error('✗ Failed to create room:', (err as Error).message);
    process.exit(1);
  }
  client.stopClient();
}
main().catch((err) => {
  console.error('Error:', err.message);
  client.stopClient();
  process.exit(1);
});

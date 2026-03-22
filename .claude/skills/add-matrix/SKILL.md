---
name: add-matrix
description: Add Matrix as a channel. Can replace other channels entirely or run alongside them. Uses homeserver URL and access token for authentication.
---

# Add Matrix Channel

This skill adds Matrix support to NanoClaw. It installs the Matrix channel code, dependencies, and guides through authentication, registration, and configuration.

## Phase 1: Pre-flight

### Check current state

Check if Matrix is already configured. If `MATRIX_HOMESERVER_URL` and `MATRIX_ACCESS_TOKEN` exist in `.env`, skip to Phase 4 (Registration).

```bash
grep -q "MATRIX_HOMESERVER_URL" .env 2>/dev/null && echo "Matrix configured" || echo "No Matrix config"
```

### Ask the user

Use `AskUserQuestion` to collect configuration:

AskUserQuestion: Do you have Matrix credentials, or do you need to get them?

If they have credentials, collect them now. If not, we'll get them in Phase 3.

## Phase 2: Apply Code Changes

Check if `src/channels/matrix.ts` already exists. If it does, skip to Phase 3 (Authentication).

### Merge the skill branch

```bash
git fetch origin
```

The Matrix channel code adds:
- `src/channels/matrix.ts` (MatrixChannel class with self-registration via `registerChannel`)
- `src/channels/matrix.test.ts` (unit tests)
- `import './matrix.js'` appended to the channel barrel file `src/channels/index.ts`
- `matrix-js-sdk` npm dependency in `package.json`
- `MATRIX_HOMESERVER_URL` and `MATRIX_ACCESS_TOKEN` in `.env.example`

Run the setup script to apply changes:

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-matrix
```

Or manually apply by creating the files.

### Validate code changes

```bash
npm install
npm run build
npx vitest run src/channels/matrix.test.ts
```

All tests must pass and build must be clean before proceeding.

## Phase 3: Authentication

### Get Matrix credentials

If the user needs credentials, tell them:

> I need you to get your Matrix access token:
>
> 1. Open your Matrix client (Element, SchildiChat, etc.)
> 2. Go to **Settings** > **Help & About** (or **All settings**)
> 3. Scroll to the bottom and click **Access Token** to reveal it
> 4. Copy the token (looks like `syt_xxxxxxxxxxxxxxxx`)
>
> For the homeserver URL, use:
> - Element/Matrix.org: `https://matrix-client.matrix.org`
> - Your own server: `https://matrix.yourdomain.com`

Collect:
- `MATRIX_HOMESERVER_URL` (e.g., `https://matrix-client.matrix.org`)
- `MATRIX_ACCESS_TOKEN` (the long token string)
- Optional: `MATRIX_USER_ID` (e.g., `@username:matrix.org`)

### Configure environment

Create `.env` if it doesn't exist, or append to it:

```bash
MATRIX_HOMESERVER_URL=<their-homeserver-url>
MATRIX_ACCESS_TOKEN=<their-access-token>
MATRIX_USER_ID=<their-user-id>
```

Channels auto-enable when their credentials are present.

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

## Phase 4: Room Setup

### Option A: Use existing room

If the user has an existing room, collect the Room ID:

> To get your Matrix room ID:
>
> 1. Open your Matrix client and go to the room you want to use
> 2. Click the room name > **Settings** > **Advanced**
> 3. Copy the **Internal room ID** (looks like `!xxxxxxxx:matrix.org`)

### Option B: Create a new room

Use `AskUserQuestion` to configure the new room:

**AskUserQuestion:** Room visibility?
- **Private (Space members only)** — Recommended for team workspaces. Space members can see and join without invitation
- **Invite only** — Only invited users can join. You manage membership manually
- **Public** — Anyone can discover and join

**If Space members only was selected, get the Space ID:**

```bash
# List joined rooms to find the space
curl -s "$HOMESERVER_URL/_matrix/client/v3/joined_rooms" \
  -H "Authorization: Bearer $MATRIX_ACCESS_TOKEN"
```

A Space has `"type": "m.space"` in its `m.room.create` state event.

**Create the room with restricted join rules:**

```bash
curl -s -X POST "$HOMESERVER_URL/_matrix/client/v3/createRoom" \
  -H "Authorization: Bearer $MATRIX_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "nanoclaw",
    "topic": "NanoClaw assistant",
    "preset": "private_chat",
    "room_version": "10",
    "initial_state": [
      {
        "type": "m.room.join_rules",
        "content": {
          "join_rule": "restricted",
          "allow": [{
            "type": "m.room_membership",
            "room_id": "<space-room-id>"
          }]
        }
      }
    ]
  }'
```

**Then link the room to the space:**

```bash
# Add as child to space
curl -s -X PUT "$HOMESERVER_URL/_matrix/client/v3/rooms/<space-id>/state/m.space.child/<new-room-id>" \
  -H "Authorization: Bearer $MATRIX_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"via":["<server-name>"],"suggested":true}'

# Add space as parent to room
curl -s -X PUT "$HOMESERVER_URL/_matrix/client/v3/rooms/<new-room-id>/state/m.space.parent/<space-id>" \
  -H "Authorization: Bearer $MATRIX_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"via":["<server-name>"],"suggested":true}'
```

**For Invite-only rooms:** Use `"join_rule": "invite"` without the `allow` array.

**For Public rooms:** Use `"join_rule": "public"`.

### Register the chat

For a main chat (responds to all messages):

```bash
npx tsx setup/index.ts --step register \
  --jid "mx:<room-id>" \
  --name "<room-name>" \
  --trigger "@${ASSISTANT_NAME}" \
  --folder "matrix_main" \
  --channel matrix \
  --is-main \
  --no-trigger-required
```

For additional rooms (trigger-only):

```bash
npx tsx setup/index.ts --step register \
  --jid "mx:<room-id>" \
  --name "<room-name>" \
  --trigger "@${ASSISTANT_NAME}" \
  --folder "matrix_<room-name>" \
  --channel matrix
```

## Phase 5: Verify

### Build and restart

```bash
npm run build
```

Restart the service:

```bash
# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux (systemd)
systemctl --user restart nanoclaw
```

### Test the connection

Tell the user:

> Send a message in your registered Matrix room:
> - For self-chat / main: Any message works
> - For rooms: Use the trigger word (e.g., "@Andy hello")
>
> The assistant should respond within a few seconds.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log
```

## Utility Scripts

The skill includes helper scripts in `scripts/` for Matrix administration:

### list-rooms.ts

Lists all rooms in a space with visibility, member count, and join rules.

**Setup:**
```bash
# Create .env file with credentials
cat > .env << EOF
MATRIX_HOMESERVER_URL="https://your-server.com"
MATRIX_ACCESS_TOKEN="syt_..."
MATRIX_USER_ID="@user:server.com"
MATRIX_SPACE_ID="!space:server.com"  # Optional, uses first space found
EOF
```

**Run:**
```bash
npx tsx .claude/skills/add-matrix/scripts/list-rooms.ts
```

**Output shows:**
- All Spaces in your account
- Rooms linked to each space
- Join rules: public / invite / restricted / knock
- Member count
- Which spaces are allowed (for restricted rooms)

### check-space.sh

Comprehensive audit of a Matrix space including members and room details.

**Run:**
```bash
bash .claude/skills/add-matrix/scripts/check-space.sh
```

**Output shows:**
- Total joined rooms
- Space members and their power levels
- Linked rooms and their configuration
- Room names, join rules, member counts

Both scripts auto-detect `.env` files in:
- Current directory (`./.env`)
- NanoClaw project root (`../../../.env`)
- Script directory

## Troubleshooting

### Room not visible to Space members

**Cause:** Space membership ≠ Room membership. In Matrix, Spaces are organizational structures - they don't grant automatic room access.

**Solutions:**

1. **Restricted join rules** (recommended): Configure the room so Space members can join without explicit invitation
2. **Invite users manually**: Send invitations to specific users
3. **Make room public**: Anyone can join (less secure)

**Check current join rules:**
```bash
curl -s "$HOMESERVER_URL/_matrix/client/v3/rooms/<room-id>/state/m.room.join_rules/" \
  -H "Authorization: Bearer $MATRIX_ACCESS_TOKEN"
```

**Result should be:**
```json
{
  "join_rule": "restricted",
  "allow": [{
    "type": "m.room_membership",
    "room_id": "<space-id>"
  }]
}
```

If you see `"join_rule": "invite"`, Space members cannot join without invitation.

### Matrix not connecting

Check:
1. Credentials are set in `.env` AND synced to `data/env/env`
2. Homeserver URL is correct (typically `https://matrix-client.matrix.org` not `https://matrix.org`)
3. Access token is valid and not expired
4. User ID format is correct (`@user:server`, not `user@server`)
5. Service is running: `systemctl --user status nanoclaw` (Linux) or `launchctl list | grep nanoclaw` (macOS)

### "Invalid token" error

- Tokens expire. Generate a new one in your Matrix client settings
- Make sure you copied the entire token (starts with `syt_`)

### "M_UNKNOWN" errors

- Check the homeserver URL format (should include protocol: `https://`)
- Verify the room ID format (starts with `!` and includes server name after `:`)

### Bot not responding

Check logs: `tail -50 logs/nanoclaw.log`

1. Room is registered: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'mx:%'"`
2. Room ID format: should be `mx:!xxxxxxxx:server.name` when registering
3. For non-main rooms: message includes trigger pattern
4. Bot is member of the room: check room members in Element

## After Setup

If running `npm run dev` while the service is active:

```bash
# macOS:
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
npm run dev
# When done testing:
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist

# Linux:
# systemctl --user stop nanoclaw
# npm run dev
# systemctl --user start nanoclaw
```

## Room Management

### Leave/Delete a room

Matrix doesn't truly "delete" rooms — they persist on the server. To remove access:

**Leave the room as the bot:**
```bash
curl -X POST "https://matrix.eb8.org/_matrix/client/v3/rooms/<room-id>/leave" \
  -H "Authorization: Bearer $MATRIX_ACCESS_TOKEN" \
  -d '{}'
```

If the bot is the last member, the room becomes orphaned (no one can access it).

**To make the room impossible to rejoin:**

1. Set to "invite" join rule first (prevents accidental rejoin via history)
2. Leave the room
3. Optionally forget the room:
```bash
curl -X POST "https://matrix.eb8.org/_matrix/client/v3/rooms/<room-id>/forget" \
  -H "Authorization: Bearer $MATRIX_ACCESS_TOKEN" \
  -d '{}'
```

### Unregister from NanoClaw

Remove the room from NanoClaw's database:
```bash
sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid = 'mx:<room-id>'"
```

## Removal (entire Matrix channel)

To completely remove Matrix integration:

1. Unregister all rooms: `npx tsx setup/index.ts --step unregister -- --channel matrix`
2. Remove credentials from `.env`: `grep -v MATRIX .env > .env.tmp && mv .env.tmp .env`
3. Delete channel files: `src/channels/matrix.ts`, `src/channels/matrix.test.ts`
4. Remove import from `src/channels/index.ts`
5. Uninstall dependency: `npm uninstall matrix-js-sdk`
6. Rebuild and restart

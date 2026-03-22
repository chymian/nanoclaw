#!/bin/bash
# Check Matrix space audit - room visibility, members, and space relationships
#
# Usage:
#   # Option 1: Set env vars directly
#   export MATRIX_HOMESERVER_URL="https://your-server.com"
#   export MATRIX_ACCESS_TOKEN="syt_..."
#   export MATRIX_USER_ID="@user:server.com"
#
#   # Option 2: Create .env file
#   cat > .env << EOF
#   MATRIX_HOMESERVER_URL="https://your-server.com"
#   MATRIX_ACCESS_TOKEN="syt_..."
#   MATRIX_USER_ID="@user:server.com"
#   EOF
#
#   ./check-space.sh

set -e

# Try to load from .env files
POSSIBLE_ENV_PATHS=(
  "$PWD/.env"
  "$(dirname "$0")/../../../.env"
  "$(dirname "$0")/.env"
)

for env_path in "${POSSIBLE_ENV_PATHS[@]}"; do
  if [ -f "$env_path" ]; then
    # Source the .env file, handling "KEY=value" format
    while IFS='=' read -r key value || [ -n "$key" ]; do
      # Skip comments and empty lines
      [[ "$key" =~ ^[[:space:]]*# ]] && continue
      [[ -z "$key" ]] && continue
      # Remove surrounding whitespace and quotes from value
      value=$(echo "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
      export "$key=$value"
    done < "$env_path"
    break
  fi
done

: "${MATRIX_HOMESERVER_URL:?Required - set MATRIX_HOMESERVER_URL or create .env file}"
: "${MATRIX_ACCESS_TOKEN:?Required - set MATRIX_ACCESS_TOKEN or create .env file}"
: "${MATRIX_USER_ID:?Required - set MATRIX_USER_ID or create .env file}"

echo "=== OPENCLAW AGENTS SPACE AUDIT ==="
echo ""
echo "User: $MATRIX_USER_ID"
echo "Server: $MATRIX_HOMESERVER_URL"
echo ""

# Encode room ID for URL
urlencode() {
  python3 -c "import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read().strip()))"
}

echo "1. JOINED ROOMS"
RESPONSE=$(curl -s "$MATRIX_HOMESERVER_URL/_matrix/client/v3/joined_rooms" \
  -H "Authorization: Bearer $MATRIX_ACCESS_TOKEN")
echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Total: {len(d[\"joined_rooms\"])}'); [print(f\"  - {r}\") for r in d['joined_rooms']]"
echo ""

# Find first space
echo "2. SPACES"
FIRST_SPACE=$(echo "$RESPONSE" | python3 -c "
import json,sys,urllib.request
d=json.load(sys.stdin)
for room in d['joined_rooms']:
    try:
        url = sys.argv[1] + '/_matrix/client/v3/rooms/' + room.replace('!', '%21').replace(':', '%3A') + '/state/m.room.create/'
        req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + sys.argv[2]})
        resp = urllib.request.urlopen(req).read().decode()
        data = json.loads(resp)
        if data.get('type') == 'm.space':
            print(room)
            break
    except:
        pass
" "$MATRIX_HOMESERVER_URL" "$MATRIX_ACCESS_TOKEN" 2>/dev/null)

if [ -z "$FIRST_SPACE" ]; then
  echo "No spaces found."
  exit 0
fi

echo "Checking space: $FIRST_SPACE"
echo ""

# Get space members
echo "3. SPACE MEMBERS"
ENCODED=$(echo "$FIRST_SPACE" | urlencode)
curl -s "$MATRIX_HOMESERVER_URL/_matrix/client/v3/rooms/$ENCODED/members" \
  -H "Authorization: Bearer $MATRIX_ACCESS_TOKEN" | python3 -c "
import json,sys
data=json.load(sys.stdin)
members=[m for m in data['chunk'] if m['content'].get('membership')=='join']
print(f'Total members: {len(members)}')
for m in members:
    name=m['content'].get('displayname','?')
    print(f\"  - {name} ({m['user_id']})\")
"
echo ""

# Get space children
echo "4. LINKED ROOMS IN SPACE"
curl -s "$MATRIX_HOMESERVER_URL/_matrix/client/v3/rooms/$ENCODED/state" \
  -H "Authorization: Bearer $MATRIX_ACCESS_TOKEN" | python3 -c "
import json,sys
data=json.load(sys.stdin)
children=[e for e in data if e['type']=='m.space.child']
print(f'Total linked rooms: {len(children)}')
for child in children:
    room_id=child['state_key']
    suggested=child['content'].get('suggested',False)
    print(f\"  - {room_id} (suggested: {suggested})\")
"
echo ""

# Detail each room
echo "5. ROOM DETAILS"
echo "$FIRST_SPACE" | python3 -c "
import json,sys,urllib.request
import urllib.error

HOMESERVER=sys.argv[1]
TOKEN=sys.argv[2]
SPACE_ID=sys.stdin.read().strip()

def api_call(path):
    try:
        url = HOMESERVER + path
        req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + TOKEN})
        resp = urllib.request.urlopen(req).read().decode()
        return json.loads(resp)
    except urllib.error.HTTPError as e:
        return {'error': str(e)}
    except Exception as e:
        return {'error': str(e)}

# Get children from space
children_resp = api_call('/_matrix/client/v3/rooms/' + SPACE_ID.replace('!', '%25%21').replace(':', '%3A') + '/state')
if 'error' in children_resp:
    children_resp = []

children = [e for e in children_resp if isinstance(e, dict) and e.get('type')=='m.space.child']

for child in children:
    room_id = child['state_key']
    print(f'\\nRoom: {room_id}')

    encoded = room_id.replace('!', '%25%21').replace(':', '%3A')

    # Name
    name = api_call(f'/_matrix/client/v3/rooms/{encoded}/state/m.room.name/')
    if 'name' in name:
        print(f'  Name: {name[\"name\"]}')

    # Join rules
    rules = api_call(f'/_matrix/client/v3/rooms/{encoded}/state/m.room.join_rules/')
    join_rule = rules.get('join_rule', 'unknown')
    print(f'  Join rule: {join_rule}')

    if join_rule == 'restricted' and 'allow' in rules:
        for rule in rules['allow']:
            if rule.get('type') == 'm.room_membership':
                print(f'    - Allowed space: {rule.get(\"room_id\", \"unknown\")}')

    # Members (simplified - would need separate call)
    print('  (Run list-rooms.ts for full member details)')
" "$MATRIX_HOMESERVER_URL" "$MATRIX_ACCESS_TOKEN"

echo ""
echo "=== END ==="

import * as sdk from 'matrix-js-sdk';
import { registerChannel } from './registry.js';
import type { Channel, OnInboundMessage, OnChatMetadata, RegisteredGroup } from '../types.js';
import { logger } from '../logger.js';

const HOMESERVER_URL = process.env.MATRIX_HOMESERVER_URL || '';
const ACCESS_TOKEN = process.env.MATRIX_ACCESS_TOKEN || '';
const USER_ID = process.env.MATRIX_USER_ID || '';

/** Matrix channel implementation */
class MatrixChannel implements Channel {
  name = 'matrix';
  private client: sdk.MatrixClient | null = null;
  private connected = false;
  private onMessage: OnInboundMessage;
  private onChatMetadata: OnChatMetadata;
  private registeredGroups: () => Record<string, RegisteredGroup>;

  constructor(opts: {
    onMessage: OnInboundMessage;
    onChatMetadata: OnChatMetadata;
    registeredGroups: () => Record<string, RegisteredGroup>;
  }) {
    this.onMessage = opts.onMessage;
    this.onChatMetadata = opts.onChatMetadata;
    this.registeredGroups = opts.registeredGroups;
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('mx:');
  }

  async connect(): Promise<void> {
    if (!HOMESERVER_URL || !ACCESS_TOKEN) {
      logger.info('Matrix not configured, skipping connection');
      return;
    }

    try {
      this.client = sdk.createClient({
        baseUrl: HOMESERVER_URL,
        accessToken: ACCESS_TOKEN,
        userId: USER_ID || undefined,
      });

      // Sync loop
      this.client.startClient({ initialSyncLimit: 10 });

      this.client.on(sdk.ClientEvent.Sync, (state: sdk.SyncState) => {
        if (state === sdk.SyncState.Prepared) {
          this.connected = true;
          logger.info('Matrix sync complete');
          this.syncGroups();
        } else if (state === sdk.SyncState.Error) {
          logger.error('Matrix sync error');
          this.connected = false;
        }
      });

      this.client.on(sdk.RoomEvent.Timeline, (event, room, toStartOfTimeline) => {
        if (toStartOfTimeline) return;
        if (event.getSender() === this.client?.getUserId()) return;

        const eventType = event.getType();
        if (eventType !== 'm.room.message') return;

        const content = event.getContent();
        const body = content.body;
        if (!body || typeof body !== 'string') return;

        const roomId = room?.roomId;
        if (!roomId) return;

        const sender = event.getSender() || 'unknown';
        const timestamp = new Date(event.getTs()).toISOString();
        const eventId = event.getId() || `${Date.now()}`;

        // Get sender display name
        const roomMember = room?.getMember(sender);
        const senderName = roomMember?.name || sender.split(':')[0].replace(/^@/, '');

        // Notify metadata
        const memberCount = room?.getJoinedMemberCount() ?? 0;
        const isGroup = memberCount > 2;
        this.onChatMetadata(`mx:${roomId}`, timestamp, room?.name || 'Matrix Room', 'matrix', isGroup);

        this.onMessage(`mx:${roomId}`, {
          id: eventId,
          chat_jid: `mx:${roomId}`,
          sender: sender,
          sender_name: senderName,
          content: body,
          timestamp: timestamp,
          is_from_me: false,
        });
      });

      // Wait for initial sync
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Matrix sync timeout')), 30000);
        this.client?.once(sdk.ClientEvent.Sync, (state) => {
          clearTimeout(timeout);
          if (state === sdk.SyncState.Prepared) {
            resolve();
          } else if (state === sdk.SyncState.Error) {
            reject(new Error('Matrix sync failed'));
          }
        });
      });
    } catch (err) {
      logger.error({ err }, 'Failed to connect to Matrix');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.stopClient();
      this.connected = false;
      logger.info('Matrix disconnected');
    }
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('Matrix not connected');
    }

    const roomId = jid.replace(/^mx:/, '');

    try {
      await this.client.sendTextMessage(roomId, text);
    } catch (err) {
      logger.error({ err, roomId }, 'Failed to send Matrix message');
      throw err;
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.client || !this.connected) return;

    const roomId = jid.replace(/^mx:/, '');

    try {
      await this.client.sendTyping(roomId, isTyping, 30000);
    } catch (err) {
      logger.error({ err, roomId }, 'Failed to set Matrix typing indicator');
    }
  }

  async syncGroups(force = false): Promise<void> {
    if (!this.client) return;

    try {
      const rooms = this.client.getRooms();
      for (const room of rooms) {
        const roomId = room.roomId;
        const isGroup = room.getJoinedMemberCount() > 2;
        const timestamp = new Date().toISOString();
        this.onChatMetadata(`mx:${roomId}`, timestamp, room.name || 'Unnamed Room', 'matrix', isGroup);
      }
      logger.info({ count: rooms.length }, 'Matrix rooms synced');
    } catch (err) {
      logger.error({ err }, 'Failed to sync Matrix rooms');
    }
  }
}

// Self-registration
registerChannel('matrix', (opts) => {
  if (!HOMESERVER_URL || !ACCESS_TOKEN) {
    return null;
  }
  return new MatrixChannel(opts);
});

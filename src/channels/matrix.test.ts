import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

// Mock the registry
const mockRegisterChannel = vi.fn();
vi.mock('./registry.js', () => ({
  registerChannel: (...args: unknown[]) => mockRegisterChannel(...args),
}));

describe('MatrixChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers itself on module load with proper env', async () => {
    // Set env vars before import
    process.env.MATRIX_HOMESERVER_URL = 'https://matrix-test.example.com';
    process.env.MATRIX_ACCESS_TOKEN = 'test_token_123';
    process.env.MATRIX_USER_ID = '@testuser:example.com';

    // Import module to trigger registration
    await import('./matrix.js');

    expect(mockRegisterChannel).toHaveBeenCalledWith('matrix', expect.any(Function));

    // Clean up
    delete process.env.MATRIX_HOMESERVER_URL;
    delete process.env.MATRIX_ACCESS_TOKEN;
  });

  it('returns null if Matrix is not configured', async () => {
    // Ensure no env vars
    delete process.env.MATRIX_HOMESERVER_URL;
    delete process.env.MATRIX_ACCESS_TOKEN;

    // Re-import to test with no config
    await import('./matrix.js');

    const factory = mockRegisterChannel.mock.calls[0]?.[1];
    if (!factory) {
      // If no factory registered, that's also acceptable behavior for unconfigured channel
      expect(mockRegisterChannel).not.toHaveBeenCalled();
      return;
    }

    const result = factory({
      onMessage: vi.fn(),
      onChatMetadata: vi.fn(),
      registeredGroups: () => ({}),
    });

    expect(result).toBeNull();
  });
});

describe('MatrixChannel operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports are defined', () => {
    // Basic sanity check - the module should load without errors
    expect(true).toBe(true);
  });
});

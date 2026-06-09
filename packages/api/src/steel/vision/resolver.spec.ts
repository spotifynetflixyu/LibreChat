import { resolveEvidenceFileForProvider } from './resolver';

describe('Steel evidence file resolver', () => {
  it('resolves a persisted Mongo File ref into an OAuth provider file part', async () => {
    const bytes = new Uint8Array(Buffer.from('PNG_SENTINEL', 'utf8'));
    const findFile = jest.fn(async () => ({
      file_id: 'file_123',
      user: 'user_1',
      conversationId: 'conversation_1',
      filename: 'c.png',
      filepath: '/uploads/user_1/file_123__c.png',
      source: 'local',
      type: 'image/png',
      bytes: bytes.length,
    }));
    const readFileBytes = jest.fn(async () => bytes);

    const result = await resolveEvidenceFileForProvider({
      fileId: 'file_123',
      userId: 'user_1',
      conversationId: 'conversation_1',
      findFile,
      readFileBytes,
    });

    expect(findFile).toHaveBeenCalledWith('file_123');
    expect(readFileBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file_123',
        fileRef: {
          source: 'local',
          filepath: '/uploads/user_1/file_123__c.png',
        },
      }),
    );
    expect(result).toEqual({
      filename: 'c.png',
      mediaType: 'image/png',
      data: bytes,
    });
  });

  it('rejects missing files before storage reads', async () => {
    const findFile = jest.fn(async () => null);
    const readFileBytes = jest.fn();

    await expect(
      resolveEvidenceFileForProvider({
        fileId: 'missing_file',
        userId: 'user_1',
        conversationId: 'conversation_1',
        findFile,
        readFileBytes,
      }),
    ).rejects.toThrow('Steel evidence file not found');
    expect(readFileBytes).not.toHaveBeenCalled();
  });

  it('rejects files owned by another user', async () => {
    const findFile = jest.fn(async () => ({
      file_id: 'file_123',
      user: 'user_2',
      conversationId: 'conversation_1',
      filename: 'scan.pdf',
      filepath: '/uploads/user_2/file_123__scan.pdf',
      source: 'local',
      type: 'application/pdf',
      bytes: 10,
    }));
    const readFileBytes = jest.fn();

    await expect(
      resolveEvidenceFileForProvider({
        fileId: 'file_123',
        userId: 'user_1',
        conversationId: 'conversation_1',
        findFile,
        readFileBytes,
      }),
    ).rejects.toThrow('Steel evidence file is not accessible');
    expect(readFileBytes).not.toHaveBeenCalled();
  });

  it('rejects files from another conversation', async () => {
    const findFile = jest.fn(async () => ({
      file_id: 'file_123',
      user: 'user_1',
      conversationId: 'conversation_2',
      filename: 'scan.pdf',
      filepath: '/uploads/user_1/file_123__scan.pdf',
      source: 'local',
      type: 'application/pdf',
      bytes: 10,
    }));
    const readFileBytes = jest.fn();

    await expect(
      resolveEvidenceFileForProvider({
        fileId: 'file_123',
        userId: 'user_1',
        conversationId: 'conversation_1',
        findFile,
        readFileBytes,
      }),
    ).rejects.toThrow('Steel evidence file is not accessible');
    expect(readFileBytes).not.toHaveBeenCalled();
  });
});

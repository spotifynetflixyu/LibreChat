import fs from 'fs';
import sharp from 'sharp';
import type { ServerRequest } from '~/types';
import type { SaveBufferFn } from '~/storage/types';
import type { ImageServiceDeps } from '~/storage/images';
import { ImageService } from '~/storage/images';

const maxImageBytes = 5 * 1024 * 1024;
const mockSharpState: {
  instances: Array<{
    rotate: jest.Mock;
    resize: jest.Mock;
    jpeg: jest.Mock;
    toFormat: jest.Mock;
    toBuffer: jest.Mock;
    metadata: jest.Mock;
    clone: jest.Mock;
  }>;
  outputs: Array<{ buffer: Buffer; width: number; height: number }>;
} = {
  instances: [],
  outputs: [],
};

jest.mock('fs', () => {
  const actualFs = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actualFs,
    promises: {
      ...actualFs.promises,
      readFile: jest.fn(),
      unlink: jest.fn(),
    },
  };
});

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn() },
}));

jest.mock('sharp', () => {
  const mockSharp = jest.fn(() => {
    const instance = {
      rotate: jest.fn().mockReturnThis(),
      resize: jest.fn().mockReturnThis(),
      jpeg: jest.fn().mockReturnThis(),
      toFormat: jest.fn().mockReturnThis(),
      metadata: jest.fn().mockResolvedValue({ format: 'png', width: 100, height: 100 }),
      toBuffer: jest.fn(async (options?: { resolveWithObject?: boolean }) => {
        const output = mockSharpState.outputs.shift() ?? {
          buffer: Buffer.from('processed'),
          width: 1600,
          height: 1200,
        };

        if (options?.resolveWithObject) {
          return {
            data: output.buffer,
            info: {
              width: output.width,
              height: output.height,
              size: output.buffer.length,
            },
          };
        }

        return output.buffer;
      }),
      clone: jest.fn(),
    };
    instance.clone.mockReturnValue(instance);
    mockSharpState.instances.push(instance);
    return instance;
  });
  return mockSharp;
});

describe('ImageService', () => {
  let mockSaveBuffer: jest.MockedFunction<SaveBufferFn>;
  let mockDeps: ImageServiceDeps;
  let service: ImageService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSharpState.instances = [];
    mockSharpState.outputs = [
      {
        buffer: Buffer.from('processed-jpeg'),
        width: 1600,
        height: 1200,
      },
    ];

    mockSaveBuffer = jest
      .fn()
      .mockResolvedValue('https://storage.example.com/images/user123/file.jpg');

    mockDeps = {
      updateUser: jest.fn().mockResolvedValue(undefined),
      updateFile: jest.fn().mockResolvedValue(null),
    };

    service = new ImageService(mockSaveBuffer, mockDeps);
  });

  describe('uploadImage', () => {
    const mockReq = {
      user: { id: 'user123' },
      config: { imageOutputType: 'webp' },
    };

    const mockFile = {
      path: '/tmp/upload-123.jpg',
      originalname: 'photo.jpg',
    } as Express.Multer.File;

    beforeEach(() => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(Buffer.from('original'));
      (fs.promises.unlink as jest.Mock).mockResolvedValue(undefined);
    });

    it('converts uploaded images to JPG capped at 4K and 5 MB', async () => {
      mockSharpState.outputs = [
        {
          buffer: Buffer.alloc(maxImageBytes),
          width: 4096,
          height: 2304,
        },
      ];

      const result = await service.uploadImage({
        req: mockReq as ServerRequest,
        file: mockFile,
        file_id: 'file-456',
        endpoint: 'openAI',
      });

      expect(result).toEqual({
        filepath: 'https://storage.example.com/images/user123/file.jpg',
        bytes: maxImageBytes,
        width: 4096,
        height: 2304,
        filename: 'photo.jpg',
        type: 'image/jpeg',
      });

      expect(mockSharpState.instances[0].rotate).toHaveBeenCalledTimes(1);
      expect(mockSharpState.instances[0].resize).toHaveBeenCalledWith({
        width: 4096,
        height: 4096,
        fit: 'inside',
        withoutEnlargement: true,
      });
      expect(mockSharpState.instances[0].jpeg).toHaveBeenCalledWith({
        quality: 85,
        mozjpeg: true,
      });

      const saveBufferArgs = mockSaveBuffer.mock.calls[0][0];
      expect(saveBufferArgs.buffer).toHaveLength(maxImageBytes);
      expect(saveBufferArgs).toEqual({
        userId: 'user123',
        buffer: saveBufferArgs.buffer,
        fileName: expect.stringMatching(/^file-456__.+\.jpg$/),
        basePath: 'images',
        contentType: 'image/jpeg',
        tenantId: null,
      });

      expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/upload-123.jpg');
    });

    it('throws error when user not authenticated', async () => {
      const reqNoUser = { config: {} };

      await expect(
        service.uploadImage({
          req: reqNoUser as ServerRequest,
          file: mockFile,
          file_id: 'file-456',
          endpoint: 'openAI',
        }),
      ).rejects.toThrow('User not authenticated');
    });

    it('preserves image dimensions below 4K through no-upscale resize options', async () => {
      mockSharpState.outputs = [
        {
          buffer: Buffer.from('small-jpeg'),
          width: 1600,
          height: 1200,
        },
      ];
      const pngFile = {
        path: '/tmp/upload-123.png',
        originalname: 'photo.png',
      } as Express.Multer.File;

      const result = await service.uploadImage({
        req: mockReq as ServerRequest,
        file: pngFile,
        file_id: 'file-456',
        endpoint: 'openAI',
      });

      expect(result).toEqual(
        expect.objectContaining({
          bytes: Buffer.byteLength('small-jpeg'),
          width: 1600,
          height: 1200,
          filename: 'photo.jpg',
          type: 'image/jpeg',
        }),
      );
      expect(mockSharpState.instances[0].resize).toHaveBeenCalledWith(
        expect.objectContaining({ withoutEnlargement: true }),
      );
      expect(mockSaveBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: expect.stringMatching(/^file-456__.+\.jpg$/),
        }),
      );
    });

    it('reduces JPEG quality until the image fits under 5 MB', async () => {
      mockSharpState.outputs = [
        {
          buffer: Buffer.alloc(maxImageBytes + 1),
          width: 4096,
          height: 2304,
        },
        {
          buffer: Buffer.alloc(maxImageBytes - 1),
          width: 4096,
          height: 2304,
        },
      ];

      await service.uploadImage({
        req: mockReq as ServerRequest,
        file: mockFile,
        file_id: 'file-456',
        endpoint: 'openAI',
      });

      expect(mockSharpState.instances[0].jpeg).toHaveBeenNthCalledWith(1, {
        quality: 85,
        mozjpeg: true,
      });
      expect(mockSharpState.instances[0].jpeg).toHaveBeenNthCalledWith(2, {
        quality: 80,
        mozjpeg: true,
      });
      expect(mockSaveBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          buffer: expect.objectContaining({ length: maxImageBytes - 1 }),
        }),
      );
    });

    it('uses custom basePath when provided', async () => {
      await service.uploadImage({
        req: mockReq as ServerRequest,
        file: mockFile,
        file_id: 'file-456',
        endpoint: 'openAI',
        basePath: 'avatars',
      });

      expect(mockSaveBuffer).toHaveBeenCalledWith(expect.objectContaining({ basePath: 'avatars' }));
    });

    it('uses JPG even when imageOutputType is not configured', async () => {
      const reqNoConfig = { user: { id: 'user123' }, config: {} };

      await service.uploadImage({
        req: reqNoConfig as ServerRequest,
        file: mockFile,
        file_id: 'file-456',
        endpoint: 'openAI',
      });

      expect(mockSaveBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: expect.stringMatching(/\.jpg$/),
        }),
      );
    });

    it('deletes temp file when readFile throws', async () => {
      (fs.promises.readFile as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));

      await expect(
        service.uploadImage({
          req: mockReq as ServerRequest,
          file: mockFile,
          file_id: 'file-456',
          endpoint: 'openAI',
        }),
      ).rejects.toThrow('ENOENT');

      expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/upload-123.jpg');
    });

    it('deletes temp file when compression throws', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValueOnce(Buffer.from('raw'));
      mockSharpState.outputs = [];
      (sharp as unknown as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Compression failed');
      });

      await expect(
        service.uploadImage({
          req: mockReq as ServerRequest,
          file: mockFile,
          file_id: 'file-456',
          endpoint: 'openAI',
        }),
      ).rejects.toThrow('Compression failed');

      expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/upload-123.jpg');
    });
  });

  describe('prepareImageURL', () => {
    it('updates file and returns the updated document alongside its filepath', async () => {
      const file = { file_id: 'file-123', filepath: 'https://example.com/image.webp' };

      const result = await service.prepareImageURL(file);

      expect(result).toEqual([null, 'https://example.com/image.webp']);
      expect(mockDeps.updateFile).toHaveBeenCalledWith({ file_id: 'file-123' });
    });

    it('returns the updated MongoFile as the first element when found', async () => {
      const mongoFile = { file_id: 'file-123', filepath: 'https://example.com/image.webp' };
      (mockDeps.updateFile as jest.Mock).mockResolvedValue(mongoFile);

      const file = { file_id: 'file-123', filepath: 'https://example.com/image.webp' };
      const result = await service.prepareImageURL(file);

      expect(result[0]).toEqual(mongoFile);
      expect(result[1]).toBe('https://example.com/image.webp');
    });
  });

  describe('processAvatar', () => {
    it('processes and uploads avatar for user', async () => {
      const buffer = Buffer.from('avatar-data');

      const result = await service.processAvatar({
        buffer,
        userId: 'user123',
        manual: 'true',
      });

      expect(result).toBe('https://storage.example.com/images/user123/file.jpg');
      expect(mockSaveBuffer).toHaveBeenCalledWith({
        userId: 'user123',
        buffer,
        fileName: expect.stringMatching(/^avatar-\d+\.png$/),
        basePath: 'avatars',
        tenantId: null,
      });
      expect(mockDeps.updateUser).toHaveBeenCalledWith('user123', {
        avatar: 'https://storage.example.com/images/user123/file.jpg',
      });
    });

    it('does not update user when manual is false', async () => {
      const buffer = Buffer.from('avatar-data');

      await service.processAvatar({
        buffer,
        userId: 'user123',
        manual: 'false',
      });

      expect(mockDeps.updateUser).not.toHaveBeenCalled();
    });

    it('creates agent avatar with correct filename and skips user update', async () => {
      const buffer = Buffer.from('avatar-data');

      await service.processAvatar({
        buffer,
        userId: 'user123',
        manual: 'true',
        agentId: 'agent-456',
      });

      expect(mockSaveBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: expect.stringMatching(/^agent-agent-456-avatar-\d+\.png$/),
        }),
      );
      expect(mockDeps.updateUser).not.toHaveBeenCalled();
    });

    it('passes tenantId through for avatar storage', async () => {
      const buffer = Buffer.from('avatar-data');

      await service.processAvatar({
        buffer,
        userId: 'user123',
        manual: 'false',
        tenantId: 'tenantA',
      });

      expect(mockSaveBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          basePath: 'avatars',
          tenantId: 'tenantA',
        }),
      );
    });

    it('appends manual param when config.appendManualParam is true', async () => {
      const serviceWithManualParam = new ImageService(mockSaveBuffer, mockDeps, {
        appendManualParam: true,
      });

      const buffer = Buffer.from('avatar-data');

      const result = await serviceWithManualParam.processAvatar({
        buffer,
        userId: 'user123',
        manual: 'true',
      });

      expect(result).toBe('https://storage.example.com/images/user123/file.jpg?manual=true');
    });

    it('uses gif extension for animated images', async () => {
      (sharp as unknown as jest.Mock).mockImplementationOnce(() => ({
        metadata: jest.fn().mockResolvedValue({ format: 'gif' }),
      }));

      const buffer = Buffer.from('gif-data');

      await service.processAvatar({
        buffer,
        userId: 'user123',
        manual: 'false',
      });

      expect(mockSaveBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: expect.stringMatching(/\.gif$/),
        }),
      );
    });
  });
});

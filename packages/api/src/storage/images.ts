import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { logger } from '@librechat/data-schemas';
import type { IUser } from '@librechat/data-schemas';
import type { TFile } from 'librechat-data-provider';
import type {
  SaveBufferFn,
  UploadImageParams,
  ImageUploadResult,
  ProcessAvatarParams,
} from '~/storage/types';
import { AVATAR_BASE_PATH, DEFAULT_BASE_PATH as defaultBasePath } from '~/storage/constants';

const JPEG_CONTENT_TYPE = 'image/jpeg';
const JPEG_EXTENSION = '.jpg';
const MAX_IMAGE_DIMENSION = 4096;
const MAX_JPEG_UPLOAD_BYTES = 5 * 1024 * 1024;
const JPEG_QUALITY_START = 85;
const JPEG_QUALITY_MIN = 35;
const JPEG_QUALITY_STEP = 5;

const replaceExtension = (fileName: string, extension: string): string => {
  const currentExtension = path.extname(fileName);
  if (!currentExtension) {
    return `${fileName}${extension}`;
  }
  return `${fileName.slice(0, -currentExtension.length)}${extension}`;
};

const compressImageToJpeg = async (
  inputBuffer: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> => {
  const image = sharp(inputBuffer).rotate().resize({
    width: MAX_IMAGE_DIMENSION,
    height: MAX_IMAGE_DIMENSION,
    fit: 'inside',
    withoutEnlargement: true,
  });

  for (let quality = JPEG_QUALITY_START; quality >= JPEG_QUALITY_MIN; quality -= JPEG_QUALITY_STEP) {
    const { data, info } = await image
      .clone()
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    if (data.length <= MAX_JPEG_UPLOAD_BYTES) {
      return {
        buffer: data,
        width: info.width,
        height: info.height,
      };
    }
  }

  throw new Error('Processed image exceeds 5 MB after JPEG compression');
};

export interface ImageServiceDeps {
  updateUser: (userId: string, update: { avatar: string }) => Promise<IUser | null>;
  updateFile: (params: { file_id: string }) => Promise<TFile>;
}

export interface ImageServiceConfig {
  /** If true, appends ?manual=... to avatar URLs (Firebase/Azure behavior) */
  appendManualParam?: boolean;
}

/**
 * Unified image service for cloud storage strategies.
 * Handles image uploads, URL preparation, and avatar processing
 * via an injected `saveBuffer` function, enabling any storage backend
 * (S3, CloudFront, Azure, Firebase, etc.) without subclassing.
 */
export class ImageService {
  /**
   * @param saveBuffer - Strategy-specific function that persists a buffer and returns a download URL.
   * @param deps - External dependencies (resize, user/file update callbacks).
   * @param config - Optional per-strategy configuration.
   */
  constructor(
    private saveBuffer: SaveBufferFn,
    private deps: ImageServiceDeps,
    private config: ImageServiceConfig = {},
  ) {}

  /**
   * Resizes, converts, and uploads an image file to cloud storage.
   * Deletes the local temp file after a successful upload.
   */
  async uploadImage({
    req,
    file,
    file_id,
    basePath = defaultBasePath,
  }: UploadImageParams): Promise<ImageUploadResult> {
    const inputFilePath = file.path;
    try {
      if (!req.user) {
        throw new Error('[ImageService.uploadImage] User not authenticated');
      }

      const inputBuffer = await fs.promises.readFile(inputFilePath);
      const { buffer: processedBuffer, width, height } = await compressImageToJpeg(inputBuffer);

      const userId = req.user.id;
      const sourceName = path.basename(file.originalname || inputFilePath);
      const filename = replaceExtension(sourceName, JPEG_EXTENSION);
      const fileName = `${file_id}__${filename}`;

      const downloadURL = await this.saveBuffer({
        userId,
        buffer: processedBuffer,
        fileName,
        basePath,
        contentType: JPEG_CONTENT_TYPE,
        tenantId: req.user.tenantId ?? null,
      });
      const bytes = processedBuffer.length;
      return { filepath: downloadURL, bytes, width, height, filename, type: JPEG_CONTENT_TYPE };
    } catch (error) {
      logger.error('[ImageService.uploadImage] Error uploading image:', (error as Error).message);
      throw error;
    } finally {
      await fs.promises
        .unlink(inputFilePath)
        .catch((e: unknown) =>
          logger.error(
            '[ImageService.uploadImage] Failed to delete temp file:',
            (e as Error).message,
          ),
        );
    }
  }

  async prepareImageURL(file: { file_id: string; filepath: string }): Promise<[TFile, string]> {
    try {
      return await Promise.all([this.deps.updateFile({ file_id: file.file_id }), file.filepath]);
    } catch (error) {
      logger.error(
        '[ImageService.prepareImageURL] Error preparing image URL:',
        (error as Error).message,
      );
      throw error;
    }
  }

  /**
   * Processes and uploads an avatar image.
   * Detects GIF vs PNG, generates a timestamped filename, and optionally
   * persists the URL to the user record when `manual` is `'true'`.
   */
  async processAvatar({
    buffer,
    userId,
    manual,
    agentId,
    basePath = AVATAR_BASE_PATH,
    tenantId = null,
  }: ProcessAvatarParams): Promise<string> {
    try {
      const metadata = await sharp(buffer).metadata();
      const extension = metadata.format ?? 'png';
      const timestamp = new Date().getTime();

      const fileName = agentId
        ? `agent-${agentId}-avatar-${timestamp}.${extension}`
        : `avatar-${timestamp}.${extension}`;

      const downloadURL = await this.saveBuffer({ userId, buffer, fileName, basePath, tenantId });

      const finalURL = this.config.appendManualParam
        ? `${downloadURL}?manual=${manual === 'true'}`
        : downloadURL;

      if (manual === 'true' && !agentId) {
        await this.deps.updateUser(userId, { avatar: finalURL });
      }

      return finalURL;
    } catch (error) {
      logger.error(
        '[ImageService.processAvatar] Error processing avatar:',
        (error as Error).message,
      );
      throw error;
    }
  }
}

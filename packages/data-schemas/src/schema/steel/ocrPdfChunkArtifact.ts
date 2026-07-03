import { Schema } from 'mongoose';

import type { ISteelOcrPdfChunkArtifact, SteelOcrPdfChunkArtifactFile } from '~/types';

const steelOcrPdfChunkArtifactFileSchema: Schema<SteelOcrPdfChunkArtifactFile> =
  new Schema<SteelOcrPdfChunkArtifactFile>(
    {
      source: {
        type: String,
        enum: ['s3', 'cloudfront'],
        required: true,
      },
      storageKey: {
        type: String,
        required: true,
      },
      storageRegion: {
        type: String,
      },
      filepath: {
        type: String,
        required: true,
      },
      filename: {
        type: String,
        required: true,
      },
      bytes: {
        type: Number,
        required: true,
      },
      contentType: {
        type: String,
        enum: ['application/pdf'],
        required: true,
      },
    },
    { _id: false },
  );

const steelOcrPdfChunkArtifactSchema: Schema<ISteelOcrPdfChunkArtifact> =
  new Schema<ISteelOcrPdfChunkArtifact>(
    {
      sourcePdfKey: {
        type: String,
        required: true,
        index: true,
      },
      sourceStorageKey: {
        type: String,
      },
      sourceFileId: {
        type: String,
      },
      sourceFilename: {
        type: String,
      },
      sourceBytes: {
        type: Number,
      },
      pipelineVersion: {
        type: Number,
        required: true,
      },
      chunkIndex: {
        type: Number,
        required: true,
      },
      chunkCount: {
        type: Number,
        required: true,
      },
      pageStart: {
        type: Number,
        required: true,
      },
      pageEnd: {
        type: Number,
        required: true,
      },
      chunkSizePages: {
        type: Number,
        required: true,
      },
      artifact: {
        type: steelOcrPdfChunkArtifactFileSchema,
        required: true,
      },
    },
    { timestamps: true },
  );

steelOcrPdfChunkArtifactSchema.index(
  {
    sourcePdfKey: 1,
    pipelineVersion: 1,
    chunkSizePages: 1,
    chunkIndex: 1,
    pageStart: 1,
    pageEnd: 1,
  },
  { unique: true },
);

export default steelOcrPdfChunkArtifactSchema;

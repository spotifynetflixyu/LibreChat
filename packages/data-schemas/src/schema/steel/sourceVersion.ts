import { Schema } from 'mongoose';

import {
  steelSourceConversionStatusEnum,
  steelSourceNormalizedFormatEnum,
  steelSourceOriginalFormatEnum,
} from './common';

import type { ISteelSourceVersion } from '~/types';

const steelSourceVersionSchema: Schema<ISteelSourceVersion> = new Schema<ISteelSourceVersion>(
  {
    projectSourceId: {
      type: String,
      index: true,
    },
    sourceId: {
      type: String,
      index: true,
    },
    originalFileId: {
      type: String,
      required: true,
    },
    originalFormat: {
      type: String,
      enum: steelSourceOriginalFormatEnum,
      required: true,
    },
    normalizedFormat: {
      type: String,
      enum: steelSourceNormalizedFormatEnum,
    },
    normalizedFileId: String,
    conversionStatus: {
      type: String,
      enum: steelSourceConversionStatusEnum,
      default: 'not_required',
      index: true,
    },
    conversionError: String,
    sourceFileType: {
      type: String,
      required: true,
      index: true,
    },
    parseVersion: String,
    parseStatus: {
      type: String,
      enum: ['pending', 'parsed', 'failed', 'rejected'],
      default: 'pending',
      index: true,
    },
    extractionSummary: String,
    reviewStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
  },
  { timestamps: true },
);

steelSourceVersionSchema.index({ projectSourceId: 1, createdAt: -1 });
steelSourceVersionSchema.index({ sourceId: 1, createdAt: -1 });
steelSourceVersionSchema.index({ sourceFileType: 1, parseStatus: 1 });

export default steelSourceVersionSchema;

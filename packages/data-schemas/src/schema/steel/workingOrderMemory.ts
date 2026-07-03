import { Schema } from 'mongoose';

import {
  steelWorkingOrderMemoryKindEnum,
  steelWorkingOrderMemorySourceKindEnum,
  steelWorkingOrderMemoryStateEnum,
} from './common';

import type { ISteelWorkingOrderMemory, SteelWorkingOrderMemorySourceRef } from '~/types';

const steelWorkingOrderMemorySourceRefSchema: Schema<SteelWorkingOrderMemorySourceRef> =
  new Schema<SteelWorkingOrderMemorySourceRef>(
  {
    sourceKind: {
      type: String,
      required: true,
    },
    sourceId: {
      type: String,
    },
    filename: {
      type: String,
    },
    fileId: {
      type: String,
    },
    storageKey: {
      type: String,
    },
    mediaType: {
      type: String,
    },
    ocrFileKey: {
      type: String,
    },
    pageNumber: {
      type: Number,
    },
    imageIndex: {
      type: Number,
    },
    locator: {
      type: String,
    },
  },
  { _id: false },
  );

const steelWorkingOrderMemorySchema: Schema<ISteelWorkingOrderMemory> =
  new Schema<ISteelWorkingOrderMemory>(
  {
    conversationId: {
      type: String,
      required: true,
      index: true,
    },
    requestId: {
      type: String,
      index: true,
    },
    turnIndex: {
      type: Number,
      required: true,
    },
    checkpointTurnIndex: {
      type: Number,
      required: true,
      index: true,
    },
    memoryKind: {
      type: String,
      enum: steelWorkingOrderMemoryKindEnum,
      required: true,
      index: true,
    },
    sourceKind: {
      type: String,
      enum: steelWorkingOrderMemorySourceKindEnum,
      required: true,
    },
    state: {
      type: String,
      enum: steelWorkingOrderMemoryStateEnum,
      default: 'active',
      index: true,
    },
    sourceRefs: {
      type: [steelWorkingOrderMemorySourceRefSchema],
      default: undefined,
    },
    summary: {
      type: String,
    },
    payload: {
      type: Schema.Types.Mixed,
    },
    supersededAt: {
      type: Date,
    },
    supersededByMessageId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
  );

steelWorkingOrderMemorySchema.index({
  conversationId: 1,
  state: 1,
  memoryKind: 1,
  turnIndex: 1,
});
steelWorkingOrderMemorySchema.index({
  conversationId: 1,
  state: 1,
  memoryKind: 1,
  'payload.ocrFileKey': 1,
  'payload.ocrSource': 1,
});
steelWorkingOrderMemorySchema.index({
  conversationId: 1,
  state: 1,
  memoryKind: 1,
  'payload.ocrFileKey': 1,
  'payload.ocrPreprocessing.sourcePdfKey': 1,
  'payload.ocrPreprocessing.pipelineVersion': 1,
  'payload.ocrPreprocessing.chunkIndex': 1,
});
steelWorkingOrderMemorySchema.index({
  conversationId: 1,
  state: 1,
  memoryKind: 1,
  'payload.kind': 1,
  'payload.ocrSource': 1,
  'payload.ocrFileKey': 1,
  'payload.ocrPreprocessing.sourcePdfKey': 1,
  'payload.ocrPreprocessing.ocrRuleVersion': 1,
  'payload.ocrPreprocessing.pipelineVersion': 1,
  turnIndex: -1,
  createdAt: -1,
});
steelWorkingOrderMemorySchema.index({ conversationId: 1, checkpointTurnIndex: 1, state: 1 });

export default steelWorkingOrderMemorySchema;

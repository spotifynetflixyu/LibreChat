import { Schema } from 'mongoose';
import {
  steelRuleProposalChargeTypes,
  steelRuleProposalConfidences,
  steelRuleProposalParameterValueTypes,
  steelRuleProposalScopeTypes,
  steelRuleProposalStatuses,
  steelRuleProposalTypes,
} from 'librechat-data-provider';

import type {
  ISteelMemoryCandidate,
  SteelRuleProposalDefaultParameter,
  SteelRuleProposalSelector,
  SteelRuleProposalSelectorEntry,
} from '~/types';

const steelRuleProposalSelectorEntrySchema: Schema<SteelRuleProposalSelectorEntry> =
  new Schema<SteelRuleProposalSelectorEntry>(
    {
      key: { type: String, required: true },
      value: {
        type: Schema.Types.Mixed,
        validate: {
          validator: (value: unknown) => value !== undefined,
          message: 'value is required',
        },
      },
    },
    { _id: false },
  );

const steelRuleProposalSelectorSchema: Schema<SteelRuleProposalSelector> =
  new Schema<SteelRuleProposalSelector>(
    {
      catalogFamily: { type: String },
      productFamily: { type: String },
      specification: { type: String },
      workType: { type: String },
      conditionText: { type: String },
      customerAlias: { type: String },
      additionalSelectors: {
        type: [steelRuleProposalSelectorEntrySchema],
        default: [],
      },
    },
    { _id: false },
  );

const steelRuleProposalDefaultParameterSchema: Schema<SteelRuleProposalDefaultParameter> =
  new Schema<SteelRuleProposalDefaultParameter>(
    {
      key: { type: String, required: true },
      value: {
        type: Schema.Types.Mixed,
        validate: {
          validator: (value: unknown) => value !== undefined,
          message: 'value is required',
        },
      },
      valueType: {
        type: String,
        required: true,
        enum: steelRuleProposalParameterValueTypes,
      },
      unit: { type: String },
      reason: { type: String },
    },
    { _id: false },
  );

const steelMemoryCandidateSchema: Schema<ISteelMemoryCandidate> = new Schema<ISteelMemoryCandidate>(
  {
    proposalType: {
      type: String,
      required: true,
      enum: steelRuleProposalTypes,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: steelRuleProposalStatuses,
      default: 'needs_review',
      index: true,
    },
    scopeType: {
      type: String,
      required: true,
      enum: steelRuleProposalScopeTypes,
      index: true,
    },
    customerId: { type: String, index: true },
    customerTierId: { type: String, index: true },
    catalogFamily: { type: String, index: true },
    productFamily: { type: String, index: true },
    chargeType: {
      type: String,
      required: true,
      enum: steelRuleProposalChargeTypes,
      index: true,
    },
    formulaCode: {
      type: String,
      required: true,
      index: true,
    },
    formulaVersionId: { type: String },
    selector: {
      type: steelRuleProposalSelectorSchema,
      required: true,
    },
    proposedDefaultParameters: {
      type: [steelRuleProposalDefaultParameterSchema],
      required: true,
      default: [],
    },
    createdFromConversationId: {
      type: String,
      required: true,
      index: true,
    },
    createdByUserId: {
      type: String,
      required: true,
      index: true,
    },
    reviewedByUserId: { type: String, index: true },
    reviewedAt: { type: Date },
    reviewNote: { type: String },
    reason: {
      type: String,
      required: true,
    },
    confidence: {
      type: String,
      required: true,
      enum: steelRuleProposalConfidences,
      index: true,
    },
  },
  { timestamps: true },
);

steelMemoryCandidateSchema.index({ status: 1, createdAt: -1 });
steelMemoryCandidateSchema.index({ createdByUserId: 1, status: 1, updatedAt: -1 });
steelMemoryCandidateSchema.index({ scopeType: 1, customerId: 1, chargeType: 1, status: 1 });
steelMemoryCandidateSchema.index({
  catalogFamily: 1,
  productFamily: 1,
  chargeType: 1,
  status: 1,
});

export default steelMemoryCandidateSchema;

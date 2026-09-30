import { createSteelMemoryCandidateModel } from '@librechat/data-schemas';

import type {
  SteelRuleProposalCreateRecord,
  SteelRuleProposalRecord,
  SteelRuleProposalRepository,
} from './service';

type Mongoose = typeof import('mongoose');

interface SteelRuleProposalDocument extends Omit<SteelRuleProposalCreateRecord, 'selector'> {
  selector: Omit<SteelRuleProposalCreateRecord['selector'], 'additionalSelectors'> & {
    additionalSelectors?: SteelRuleProposalCreateRecord['selector']['additionalSelectors'];
  };
  _id: { toString(): string };
  createdAt?: Date;
  updatedAt?: Date;
}

function toRecord(document: SteelRuleProposalDocument): SteelRuleProposalRecord {
  const createdAt = document.createdAt ?? new Date();
  const updatedAt = document.updatedAt ?? createdAt;

  return {
    id: document._id.toString(),
    proposalType: document.proposalType,
    status: document.status,
    scopeType: document.scopeType,
    customerId: document.customerId,
    customerTierId: document.customerTierId,
    catalogFamily: document.catalogFamily,
    productFamily: document.productFamily,
    chargeType: document.chargeType,
    formulaCode: document.formulaCode,
    formulaVersionId: document.formulaVersionId,
    selector: {
      ...document.selector,
      additionalSelectors: document.selector.additionalSelectors ?? [],
    },
    proposedDefaultParameters: document.proposedDefaultParameters,
    createdFromConversationId: document.createdFromConversationId,
    createdByUserId: document.createdByUserId,
    reviewedByUserId: document.reviewedByUserId,
    reviewedAt: document.reviewedAt,
    reviewNote: document.reviewNote,
    reason: document.reason,
    confidence: document.confidence,
    createdAt,
    updatedAt,
  };
}

export function createMongooseSteelRuleProposalRepository(
  mongoose: Mongoose,
): SteelRuleProposalRepository {
  const SteelMemoryCandidate = createSteelMemoryCandidateModel(mongoose);

  return {
    async create(record) {
      const document = await SteelMemoryCandidate.create(record);
      if (document.status !== 'needs_review') {
        throw new Error('Steel rule proposal was persisted with an invalid status');
      }

      return toRecord({
        _id: document._id,
        proposalType: document.proposalType,
        status: document.status,
        scopeType: document.scopeType,
        customerId: document.customerId,
        customerTierId: document.customerTierId,
        catalogFamily: document.catalogFamily,
        productFamily: document.productFamily,
        chargeType: document.chargeType,
        formulaCode: document.formulaCode,
        formulaVersionId: document.formulaVersionId,
        selector: {
          ...document.selector,
          additionalSelectors: document.selector.additionalSelectors ?? [],
        },
        proposedDefaultParameters: document.proposedDefaultParameters,
        createdFromConversationId: document.createdFromConversationId,
        createdByUserId: document.createdByUserId,
        reviewedByUserId: document.reviewedByUserId,
        reviewedAt: document.reviewedAt,
        reviewNote: document.reviewNote,
        reason: document.reason,
        confidence: document.confidence,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      });
    },
  };
}

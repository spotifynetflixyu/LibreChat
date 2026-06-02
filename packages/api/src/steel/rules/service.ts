import {
  steelRuleProposalCreateRequestSchema,
  steelRuleProposalResponseSchema,
} from 'librechat-data-provider';

import type {
  SteelRuleProposalCreateRequest,
  SteelRuleProposalResponse,
} from 'librechat-data-provider';

export interface SteelRuleProposalRequestUser {
  id?: string;
  role?: string | null;
}

export type SteelRuleProposalCreateRecord = SteelRuleProposalCreateRequest & {
  status: 'needs_review';
  createdByUserId: string;
  reviewedByUserId?: string;
  reviewedAt?: Date;
  reviewNote?: string;
};

export type SteelRuleProposalRecord = SteelRuleProposalCreateRecord & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface SteelRuleProposalRepository {
  create(record: SteelRuleProposalCreateRecord): Promise<SteelRuleProposalRecord>;
}

export interface SteelRuleProposalServiceDeps {
  repository: SteelRuleProposalRepository;
}

export interface SteelRuleProposalCreateInput {
  body: unknown;
  user: SteelRuleProposalRequestUser | null;
}

export class SteelRuleProposalValidationError extends Error {
  statusCode = 400;
  errorCategory = 'steel_rule_proposal_invalid';

  constructor(message = 'Invalid Steel rule proposal request') {
    super(message);
    this.name = 'SteelRuleProposalValidationError';
  }
}

function requireUserId(user: SteelRuleProposalRequestUser | null): string {
  if (!user?.id) {
    throw new SteelRuleProposalValidationError(
      'Steel rule proposals require an authenticated user',
    );
  }

  return user.id;
}

function createResponse(record: SteelRuleProposalRecord): SteelRuleProposalResponse {
  return steelRuleProposalResponseSchema.parse({
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    reviewedAt: record.reviewedAt?.toISOString(),
  });
}

export function createSteelRuleProposalService({ repository }: SteelRuleProposalServiceDeps) {
  return {
    async create(input: SteelRuleProposalCreateInput): Promise<SteelRuleProposalResponse> {
      const createdByUserId = requireUserId(input.user);
      const parsed = steelRuleProposalCreateRequestSchema.safeParse(input.body);
      if (!parsed.success) {
        throw new SteelRuleProposalValidationError('Invalid Steel rule proposal request');
      }

      const record = await repository.create({
        ...parsed.data,
        status: 'needs_review',
        createdByUserId,
        reviewedByUserId: undefined,
        reviewedAt: undefined,
        reviewNote: undefined,
      });

      return createResponse(record);
    },
  };
}

import mongoose from 'mongoose';
import type { Request, Response } from 'express';
import { createSteelRuleProposalService, SteelRuleProposalValidationError } from './rules/service';
import {
  parseSteelReviewQuery,
  SteelReviewReadError,
  type SteelReviewService,
} from './review';
import {
  resolveOpenAIOAuthAuthFilePath,
  type OpenAIConfigEnv,
} from './ai/config';
import { createMongooseSteelRuleProposalRepository } from './rules/repository';
import { getOpenAIOAuthUsageRemaining } from './native/usage';
import { buildSteelModelOptions } from './models';

type ModelsConfig = Record<string, string[] | undefined>;

interface SteelRequest extends Request {
  user?: {
    id?: string;
    role?: string | null;
    tenantId?: string;
  };
  tenantId?: string;
  config?: {
    modelSpecs?: {
      list?: Array<{
        name: string;
        label?: string;
        default?: boolean;
        preset: {
          endpoint?: string | null;
          model?: string | null;
          top_p?: number;
          topP?: number;
          max_tokens?: number;
          maxOutputTokens?: number;
          reasoning_summary?: string;
          reasoningSummary?: string;
          verbosity?: string;
        };
      }>;
    };
  };
}

export interface SteelRouteHandlersDeps {
  env?: OpenAIConfigEnv;
  getModelsConfig: (req: Request) => Promise<ModelsConfig>;
  getOpenAIOAuthUsageRemaining?: typeof getOpenAIOAuthUsageRemaining;
  ruleProposalService?: ReturnType<typeof createSteelRuleProposalService>;
  reviewService?: SteelReviewService;
}

export interface SteelRouteHandlers {
  listModels(req: SteelRequest, res: Response): Promise<void>;
  readOpenAIOAuthUsage(req: SteelRequest, res: Response): Promise<void>;
  createRuleProposal(req: SteelRequest, res: Response): Promise<void>;
  readReview(req: SteelRequest, res: Response): Promise<void>;
}

function getSteelRequestUser(req: SteelRequest) {
  return req.user?.id ? { id: req.user.id, role: req.user.role } : null;
}

function sendRuleProposalError(res: Response, error: unknown) {
  if (error instanceof SteelRuleProposalValidationError) {
    res.status(error.statusCode).json({
      message: error.message,
      errorCategory: error.errorCategory,
    });
    return;
  }

  res.status(500).json({ message: 'Steel rule proposal request failed' });
}

function createDefaultRuleProposalService() {
  return createSteelRuleProposalService({
    repository: createMongooseSteelRuleProposalRepository(mongoose),
  });
}

export function createSteelRouteHandlers({
  env = process.env,
  getModelsConfig,
  getOpenAIOAuthUsageRemaining: readOpenAIOAuthUsageRemaining = getOpenAIOAuthUsageRemaining,
  ruleProposalService,
  reviewService,
}: SteelRouteHandlersDeps): SteelRouteHandlers {
  let resolvedRuleProposalService = ruleProposalService;
  let resolvedReviewService = reviewService;
  const getRuleProposalService = () =>
    (resolvedRuleProposalService ??= createDefaultRuleProposalService());

  return {
    async listModels(req, res) {
      const models = await getModelsConfig(req);
      const options = buildSteelModelOptions({
        models,
        modelSpecs: req.config?.modelSpecs,
      });
      res.status(200).json({ options });
    },

    async readOpenAIOAuthUsage(_req, res) {
      const usage = await readOpenAIOAuthUsageRemaining({
        authFilePath: resolveOpenAIOAuthAuthFilePath(env),
      });
      res.status(200).json(usage);
    },

    async createRuleProposal(req, res) {
      try {
        const result = await getRuleProposalService().create({
          body: req.body ?? {},
          user: getSteelRequestUser(req),
        });
        res.status(201).json(result);
      } catch (error) {
        sendRuleProposalError(res, error);
      }
    },

    async readReview(req, res) {
      const userId = req.user?.id;
      const conversationId = req.params.conversationId;
      const kind = req.params.kind;
      if (!userId) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      if (typeof conversationId !== 'string' || !conversationId ||
        (kind !== 'ocr_result' && kind !== 'system_order')) {
        res.status(400).json({ message: 'Invalid review table' });
        return;
      }
      try {
        if (!resolvedReviewService) {
          res.status(500).json({ message: 'Steel review read unavailable' });
          return;
        }
        const query = parseSteelReviewQuery(req.query as Record<string, unknown>);
        const result = await resolvedReviewService.read({
          userId,
          tenantId: req.tenantId ?? req.user?.tenantId,
          conversationId,
          kind,
          ...query,
        });
        res.status(200).json(result);
      } catch (error) {
        if (error instanceof SteelReviewReadError) {
          res.status(error.statusCode).json({ message: error.message, code: error.code });
          return;
        }
        res.status(500).json({ message: 'Steel review read failed' });
      }
    },
  };
}

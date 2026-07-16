import mongoose from 'mongoose';
import { buildSteelModelOptions } from './models';
import { createMongooseSteelRuleProposalRepository } from './rules/repository';
import { createSteelRuleProposalService, SteelRuleProposalValidationError } from './rules/service';
import {
  resolveOpenAIOAuthAuthFilePath,
  type OpenAIConfigEnv,
} from './ai/config';
import { getOpenAIOAuthUsageRemaining } from './native/usage';

import type { Request, Response } from 'express';

type ModelsConfig = Record<string, string[] | undefined>;

interface SteelRequest extends Request {
  user?: {
    id?: string;
    role?: string | null;
  };
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
}

export interface SteelRouteHandlers {
  listModels(req: SteelRequest, res: Response): Promise<void>;
  readOpenAIOAuthUsage(req: SteelRequest, res: Response): Promise<void>;
  createRuleProposal(req: SteelRequest, res: Response): Promise<void>;
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
}: SteelRouteHandlersDeps): SteelRouteHandlers {
  const getRuleProposalService = () => ruleProposalService ?? createDefaultRuleProposalService();

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
  };
}

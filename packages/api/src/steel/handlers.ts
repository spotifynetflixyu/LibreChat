import { buildSteelModelOptions } from './models';

import type { Request, Response } from 'express';

type ModelsConfig = Record<string, string[] | undefined>;

interface SteelRequest extends Request {
  config?: {
    modelSpecs?: {
      list?: Array<{
        name: string;
        label?: string;
        default?: boolean;
        preset: {
          endpoint?: string | null;
          model?: string | null;
          temperature?: number;
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

export interface SteelHandlersDeps {
  getModelsConfig: (req: Request) => Promise<ModelsConfig>;
}

export function createSteelHandlers({ getModelsConfig }: SteelHandlersDeps) {
  return {
    async listModels(req: SteelRequest, res: Response) {
      const models = await getModelsConfig(req);
      const options = buildSteelModelOptions({
        models,
        modelSpecs: req.config?.modelSpecs,
      });
      res.status(200).json({ options });
    },
  };
}

export function createSteelAdminHandlers() {
  return {
    async requestCapabilitySmoke(_req: Request, res: Response) {
      res.status(202).json({
        status: 'accepted',
        provider: 'openai_oauth_responses',
      });
    },
  };
}

import mongoose from 'mongoose';
import { SteelReviewWriteError } from '@librechat/data-schemas';
import { steelCatalogQuerySchema, steelReviewKinds, steelReviewReceiptQuerySchema } from 'librechat-data-provider';
import type { SteelReviewKind, SteelMarkdownVersion } from 'librechat-data-provider';
import type { SteelQuotationScope } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { SteelReviewCatalogService } from './catalog';
import type { ServerRequest } from '~/types/http';
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
import {
  SteelReviewSourceError,
  type SteelReviewSourceService,
} from './sources';
import { createMongooseSteelRuleProposalRepository } from './rules/repository';
import { getOpenAIOAuthUsageRemaining } from './native/usage';
import { SteelReviewCatalogError } from './catalog';
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
    steelReview?: { catalogPageSize?: number };
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

interface SteelReviewRouteScope {
  userId: string;
  conversationId: string;
  kind: SteelReviewKind;
}

type SteelReviewRouteScopeResult =
  | { scope: SteelReviewRouteScope }
  | { status: 401 | 400; message: string };

export interface SteelRouteHandlersDeps {
  env?: OpenAIConfigEnv;
  getModelsConfig: (req: Request) => Promise<ModelsConfig>;
  getOpenAIOAuthUsageRemaining?: typeof getOpenAIOAuthUsageRemaining;
  ruleProposalService?: ReturnType<typeof createSteelRuleProposalService>;
  reviewService?: SteelReviewService;
  catalogService?: SteelReviewCatalogService;
  sourceService?: SteelReviewSourceService;
  versionsReader?: { readSteelMarkdownVersions(scope: SteelQuotationScope): Promise<SteelMarkdownVersion[] | null> };
}

export interface SteelRouteHandlers {
  listModels(req: SteelRequest, res: Response): Promise<void>;
  readOpenAIOAuthUsage(req: SteelRequest, res: Response): Promise<void>;
  createRuleProposal(req: SteelRequest, res: Response): Promise<void>;
  readVersions(req: SteelRequest, res: Response): Promise<void>;
  readReview(req: SteelRequest, res: Response): Promise<void>;
  readReviewCatalog(req: SteelRequest, res: Response): Promise<void>;
  readReviewReceipt(req: SteelRequest, res: Response): Promise<void>;
  prepareReview(req: SteelRequest, res: Response): Promise<void>;
  commitReview(req: SteelRequest, res: Response): Promise<void>;
  listReviewSources(req: SteelRequest, res: Response): Promise<void>;
  readReviewSource(req: SteelRequest, res: Response): Promise<void>;
  readReviewSourcePageCount(req: SteelRequest, res: Response): Promise<void>;
}

function getSteelRequestUser(req: SteelRequest) {
  return req.user?.id ? { id: req.user.id, role: req.user.role } : null;
}

function steelReviewWriteStatus(error: SteelReviewWriteError): 404 | 409 {
  return error.code === 'REVIEW_NOT_FOUND' ? 404 : 409;
}

function steelReviewWriteBody(error: SteelReviewWriteError): {
  message: string;
  code: SteelReviewWriteError['code'];
  recovery?: NonNullable<SteelReviewWriteError['recovery']>;
} {
  return {
    message: error.message,
    code: error.code,
    ...(error.recovery ? { recovery: error.recovery } : {}),
  };
}

function parseSteelReviewRouteScope(req: SteelRequest, invalidMessage: string): SteelReviewRouteScopeResult {
  const userId = req.user?.id;
  const conversationId = req.params.conversationId;
  const kind = req.params.kind;
  if (!userId) {
    return { status: 401, message: 'Authentication required' };
  }
  if (typeof conversationId !== 'string' || !conversationId ||
    !steelReviewKinds.includes(kind as SteelReviewKind)) {
    return { status: 400, message: invalidMessage };
  }
  return { scope: { userId, conversationId, kind: kind as SteelReviewKind } };
}

function sendSteelReviewRouteScopeError(res: Response, result: Exclude<SteelReviewRouteScopeResult, { scope: SteelReviewRouteScope }>) {
  res.status(result.status).json({ message: result.message });
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
  catalogService,
  sourceService,
  versionsReader,
}: SteelRouteHandlersDeps): SteelRouteHandlers {
  let resolvedRuleProposalService = ruleProposalService;
  const resolvedReviewService = reviewService;
  const getRuleProposalService = () =>
    (resolvedRuleProposalService ??= createDefaultRuleProposalService());

  return {
    async readVersions(req, res) {
      const userId = req.user?.id;
      const conversationId = req.params.conversationId;
      if (!userId) { res.status(401).json({ code: 'AUTH_REQUIRED' }); return; }
      if (!conversationId) { res.status(400).json({ code: 'INVALID_VERSION_QUERY' }); return; }
      if (!versionsReader) { res.status(503).json({ code: 'VERSIONS_UNAVAILABLE' }); return; }
      try {
        const versions = await versionsReader.readSteelMarkdownVersions({ userId, conversationId,
          ...(req.tenantId ?? req.user?.tenantId ? { tenantId: req.tenantId ?? req.user?.tenantId } : {}) });
        if (versions === null) { res.status(404).json({ code: 'VERSION_NOT_FOUND' }); return; }
        res.status(200).json({ versions });
      } catch {
        res.status(503).json({ code: 'VERSION_QUERY_FAILED' });
      }
    },
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
      const scopeResult = parseSteelReviewRouteScope(req, 'Invalid review table');
      if (!('scope' in scopeResult)) {
        sendSteelReviewRouteScopeError(res, scopeResult);
        return;
      }
      const { userId, conversationId, kind } = scopeResult.scope;
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

    async readReviewCatalog(req, res) {
      const userId = req.user?.id;
      const conversationId = req.params.conversationId;
      if (!userId) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      if (typeof conversationId !== 'string' || !conversationId || !catalogService) {
        res.status(400).json({ message: 'Invalid catalog query', code: 'INVALID_REVIEW_QUERY' });
        return;
      }
      const parsed = steelCatalogQuerySchema.safeParse(req.query as Record<string, unknown>);
      if (!parsed.success) {
        res.status(400).json({ message: 'Invalid catalog query', code: 'INVALID_REVIEW_QUERY' });
        return;
      }
      try {
        const result = await catalogService.search({
          scope: {
            userId,
            ...(req.tenantId ?? req.user?.tenantId ? { tenantId: req.tenantId ?? req.user?.tenantId } : {}),
            conversationId,
          },
          query: {
            ...parsed.data,
            ...(parsed.data.limit === undefined && req.config?.steelReview?.catalogPageSize !== undefined
              ? { limit: req.config.steelReview.catalogPageSize }
              : {}),
          },
        });
        res.status(200).json(result);
      } catch (error) {
        if (error instanceof SteelReviewCatalogError) {
          res.status(error.statusCode).json({ message: error.message, code: error.code });
          return;
        }
        res.status(503).json({ message: 'Steel catalog query failed', code: 'CATALOG_QUERY_FAILED' });
      }
    },

    async readReviewReceipt(req, res) {
      const scopeResult = parseSteelReviewRouteScope(req, 'Invalid review receipt query');
      if (!('scope' in scopeResult)) {
        sendSteelReviewRouteScopeError(res, scopeResult);
        return;
      }
      const { userId, conversationId, kind } = scopeResult.scope;
      try {
        if (!resolvedReviewService) {
          res.status(500).json({ message: 'Steel review receipt unavailable' });
          return;
        }
        const query = steelReviewReceiptQuerySchema.safeParse(req.query as Record<string, unknown>);
        if (!query.success) {
          res.status(400).json({ message: 'Invalid review receipt query', code: 'INVALID_REVIEW_QUERY' });
          return;
        }
        const result = await resolvedReviewService.receipt({
          userId,
          tenantId: req.tenantId ?? req.user?.tenantId,
          conversationId,
          kind,
          ...query.data,
        });
        res.status(200).json(result);
      } catch (error) {
        if (error instanceof SteelReviewReadError || error instanceof SteelReviewWriteError) {
          res.status(error instanceof SteelReviewReadError ? error.statusCode : steelReviewWriteStatus(error))
            .json(error instanceof SteelReviewWriteError
              ? steelReviewWriteBody(error)
              : { message: error.message, code: error.code });
          return;
        }
        res.status(500).json({ message: 'Steel review receipt read failed' });
      }
    },

    async listReviewSources(req, res) {
      const scopeResult = parseSteelReviewRouteScope(req, 'Invalid review source query');
      if (!('scope' in scopeResult)) {
        sendSteelReviewRouteScopeError(res, scopeResult);
        return;
      }
      const { userId, conversationId, kind } = scopeResult.scope;
      if (!sourceService) {
        res.status(500).json({ message: 'Steel review source unavailable' });
        return;
      }
      try {
        const messageId = typeof req.query.messageId === 'string' ? req.query.messageId : '';
        const title = typeof req.query.title === 'string' ? req.query.title : '';
        const result = await sourceService.list({
          userId,
          tenantId: req.tenantId ?? req.user?.tenantId,
          conversationId,
          kind,
          messageId,
          title,
        });
        res.status(200).json(result);
      } catch (error) {
        if (error instanceof SteelReviewSourceError) {
          res.status(error.statusCode).json({ message: error.message, code: error.code });
          return;
        }
        res.status(500).json({ message: 'Steel review source read failed' });
      }
    },

    async readReviewSource(req, res) {
      const fileId = req.params.fileId;
      const scopeResult = parseSteelReviewRouteScope(req, 'Invalid review source query');
      if (!('scope' in scopeResult)) {
        sendSteelReviewRouteScopeError(res, scopeResult);
        return;
      }
      if (typeof fileId !== 'string' || !fileId) {
        res.status(400).json({ message: 'Invalid review source query' });
        return;
      }
      const { userId, conversationId, kind } = scopeResult.scope;
      if (!sourceService) {
        res.status(500).json({ message: 'Steel review source unavailable' });
        return;
      }
      try {
        const messageId = typeof req.query.messageId === 'string' ? req.query.messageId : '';
        const result = await sourceService.readBinary({
          userId,
          tenantId: req.tenantId ?? req.user?.tenantId,
          conversationId,
          kind,
          fileId,
          messageId,
        }, req as ServerRequest);
        res.setHeader('Content-Type', result.source.mediaType);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(result.source.filename)}`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' blob: data:; style-src 'unsafe-inline'; sandbox");
        result.stream.on('error', () => {
          if (!res.headersSent) {
            res.status(500).json({ message: 'Steel review source stream failed' });
          } else if (!res.writableEnded) {
            res.destroy();
          }
        });
        result.stream.pipe(res);
      } catch (error) {
        if (error instanceof SteelReviewSourceError) {
          res.status(error.statusCode).json({ message: error.message, code: error.code });
          return;
        }
        res.status(500).json({ message: 'Steel review source preview failed' });
      }
    },

    async readReviewSourcePageCount(req, res) {
      const fileId = req.params.fileId;
      const scopeResult = parseSteelReviewRouteScope(req, 'Invalid review source query');
      if (!('scope' in scopeResult)) {
        sendSteelReviewRouteScopeError(res, scopeResult);
        return;
      }
      if (typeof fileId !== 'string' || !fileId) {
        res.status(400).json({ message: 'Invalid review source query' });
        return;
      }
      const { userId, conversationId, kind } = scopeResult.scope;
      if (!sourceService) {
        res.status(500).json({ message: 'Steel review source unavailable' });
        return;
      }
      try {
        const messageId = typeof req.query.messageId === 'string' ? req.query.messageId : '';
        const result = await sourceService.readPageCount({
          userId,
          tenantId: req.tenantId ?? req.user?.tenantId,
          conversationId,
          kind,
          fileId,
          messageId,
        }, req as ServerRequest);
        res.status(200).json({ pageCount: result.pageCount });
      } catch (error) {
        if (error instanceof SteelReviewSourceError) {
          res.status(error.statusCode).json({ message: error.message, code: error.code });
          return;
        }
        res.status(500).json({ message: 'Steel review source page count failed' });
      }
    },

    async prepareReview(req, res) {
      const userId = req.user?.id;
      const conversationId = req.params.conversationId;
      const kind = req.params.kind;
      if (!userId) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      if (typeof conversationId !== 'string' || !conversationId ||
        (kind !== 'ocr_result' && kind !== 'system_order')) {
        res.status(400).json({ message: 'Invalid review operation' });
        return;
      }
      try {
        if (!resolvedReviewService) {
          res.status(500).json({ message: 'Steel review save unavailable' });
          return;
        }
        const result = await resolvedReviewService.prepare({
          ...(req.body ?? {}),
          userId,
          tenantId: req.tenantId ?? req.user?.tenantId,
          conversationId,
          kind,
          sourceRequest: req as ServerRequest,
        });
        res.status(200).json(result);
      } catch (error) {
        if (error instanceof SteelReviewReadError || error instanceof SteelReviewWriteError) {
          res.status(error instanceof SteelReviewReadError ? error.statusCode : steelReviewWriteStatus(error))
            .json(error instanceof SteelReviewWriteError
              ? steelReviewWriteBody(error)
              : { message: error.message, code: error.code });
          return;
        }
        res.status(500).json({ message: 'Steel review prepare failed' });
      }
    },

    async commitReview(req, res) {
      const userId = req.user?.id;
      const conversationId = req.params.conversationId;
      const kind = req.params.kind;
      if (!userId) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      if (typeof conversationId !== 'string' || !conversationId ||
        (kind !== 'ocr_result' && kind !== 'system_order')) {
        res.status(400).json({ message: 'Invalid review operation' });
        return;
      }
      try {
        if (!resolvedReviewService) {
          res.status(500).json({ message: 'Steel review save unavailable' });
          return;
        }
        const result = await resolvedReviewService.commit({
          ...(req.body ?? {}),
          userId,
          tenantId: req.tenantId ?? req.user?.tenantId,
          conversationId,
          kind,
          sourceRequest: req as ServerRequest,
        });
        res.status(200).json(result);
      } catch (error) {
        if (error instanceof SteelReviewReadError || error instanceof SteelReviewWriteError) {
          res.status(error instanceof SteelReviewReadError ? error.statusCode : steelReviewWriteStatus(error))
            .json(error instanceof SteelReviewWriteError
              ? steelReviewWriteBody(error)
              : { message: error.message, code: error.code });
          return;
        }
        res.status(500).json({ message: 'Steel review save failed' });
      }
    },
  };
}

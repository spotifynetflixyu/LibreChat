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

interface SteelReviewRequestScope extends SteelReviewRouteScope {
  tenantId?: string;
}

/** Maps a typed review, source or catalog error to its HTTP response. */
function sendSteelReviewError(res: Response, error: unknown): boolean {
  if (error instanceof SteelReviewWriteError) {
    res.status(steelReviewWriteStatus(error)).json(steelReviewWriteBody(error));
    return true;
  }
  if (
    error instanceof SteelReviewReadError ||
    error instanceof SteelReviewSourceError ||
    error instanceof SteelReviewCatalogError
  ) {
    res.status(error.statusCode).json({ message: error.message, code: error.code });
    return true;
  }
  return false;
}

/**
 * Runs a review route for an authenticated user, conversation and review
 * kind: answers 401/400 for a bad scope and maps thrown review errors, with
 * `failed` as the fallback 500 message.
 */
async function withReviewScope(
  req: SteelRequest,
  res: Response,
  messages: { invalid: string; failed: string },
  handler: (scope: SteelReviewRequestScope) => Promise<void>,
): Promise<void> {
  const parsed = parseSteelReviewRouteScope(req, messages.invalid);
  if (!('scope' in parsed)) {
    res.status(parsed.status).json({ message: parsed.message });
    return;
  }
  try {
    await handler({ ...parsed.scope, tenantId: req.tenantId ?? req.user?.tenantId });
  } catch (error) {
    if (!sendSteelReviewError(res, error)) {
      res.status(500).json({ message: messages.failed });
    }
  }
}

function sendUnavailable(res: Response, message: string): void {
  res.status(500).json({ message });
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
      await withReviewScope(
        req,
        res,
        { invalid: 'Invalid review table', failed: 'Steel review read failed' },
        async (scope) => {
          if (!resolvedReviewService) {
            sendUnavailable(res, 'Steel review read unavailable');
            return;
          }
          const query = parseSteelReviewQuery(req.query as Record<string, unknown>);
          res.status(200).json(await resolvedReviewService.read({ ...scope, ...query }));
        },
      );
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
        if (!sendSteelReviewError(res, error)) {
          res
            .status(503)
            .json({ message: 'Steel catalog query failed', code: 'CATALOG_QUERY_FAILED' });
        }
      }
    },

    async readReviewReceipt(req, res) {
      await withReviewScope(
        req,
        res,
        { invalid: 'Invalid review receipt query', failed: 'Steel review receipt read failed' },
        async (scope) => {
          if (!resolvedReviewService) {
            sendUnavailable(res, 'Steel review receipt unavailable');
            return;
          }
          const query = steelReviewReceiptQuerySchema.safeParse(req.query as Record<string, unknown>);
          if (!query.success) {
            res
              .status(400)
              .json({ message: 'Invalid review receipt query', code: 'INVALID_REVIEW_QUERY' });
            return;
          }
          res.status(200).json(await resolvedReviewService.receipt({ ...scope, ...query.data }));
        },
      );
    },

    async listReviewSources(req, res) {
      await withReviewScope(
        req,
        res,
        { invalid: 'Invalid review source query', failed: 'Steel review source read failed' },
        async (scope) => {
          if (!sourceService) {
            sendUnavailable(res, 'Steel review source unavailable');
            return;
          }
          const result = await sourceService.list({
            ...scope,
            messageId: typeof req.query.messageId === 'string' ? req.query.messageId : '',
            title: typeof req.query.title === 'string' ? req.query.title : '',
          });
          res.status(200).json(result);
        },
      );
    },

    async readReviewSource(req, res) {
      await withReviewScope(
        req,
        res,
        { invalid: 'Invalid review source query', failed: 'Steel review source preview failed' },
        async (scope) => {
          const fileId = req.params.fileId;
          if (typeof fileId !== 'string' || !fileId) {
            res.status(400).json({ message: 'Invalid review source query' });
            return;
          }
          if (!sourceService) {
            sendUnavailable(res, 'Steel review source unavailable');
            return;
          }
          const messageId = typeof req.query.messageId === 'string' ? req.query.messageId : '';
          const result = await sourceService.readBinary(
            { ...scope, fileId, messageId },
            req as ServerRequest,
          );
          res.setHeader('Content-Type', result.source.mediaType);
          res.setHeader(
            'Content-Disposition',
            `inline; filename*=UTF-8''${encodeURIComponent(result.source.filename)}`,
          );
          res.setHeader('Cache-Control', 'private, no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader(
            'Content-Security-Policy',
            "default-src 'none'; img-src 'self' blob: data:; style-src 'unsafe-inline'; sandbox",
          );
          result.stream.on('error', () => {
            if (!res.headersSent) {
              res.status(500).json({ message: 'Steel review source stream failed' });
            } else if (!res.writableEnded) {
              res.destroy();
            }
          });
          result.stream.pipe(res);
        },
      );
    },

    async readReviewSourcePageCount(req, res) {
      await withReviewScope(
        req,
        res,
        { invalid: 'Invalid review source query', failed: 'Steel review source page count failed' },
        async (scope) => {
          const fileId = req.params.fileId;
          if (typeof fileId !== 'string' || !fileId) {
            res.status(400).json({ message: 'Invalid review source query' });
            return;
          }
          if (!sourceService) {
            sendUnavailable(res, 'Steel review source unavailable');
            return;
          }
          const messageId = typeof req.query.messageId === 'string' ? req.query.messageId : '';
          const result = await sourceService.readPageCount(
            { ...scope, fileId, messageId },
            req as ServerRequest,
          );
          res.status(200).json({ pageCount: result.pageCount });
        },
      );
    },

    async prepareReview(req, res) {
      await withReviewScope(
        req,
        res,
        { invalid: 'Invalid review operation', failed: 'Steel review prepare failed' },
        async (scope) => {
          if (!resolvedReviewService) {
            sendUnavailable(res, 'Steel review save unavailable');
            return;
          }
          const result = await resolvedReviewService.prepare({
            ...(req.body ?? {}),
            ...scope,
            sourceRequest: req as ServerRequest,
          });
          res.status(200).json(result);
        },
      );
    },

    async commitReview(req, res) {
      await withReviewScope(
        req,
        res,
        { invalid: 'Invalid review operation', failed: 'Steel review save failed' },
        async (scope) => {
          if (!resolvedReviewService) {
            sendUnavailable(res, 'Steel review save unavailable');
            return;
          }
          const result = await resolvedReviewService.commit({
            ...(req.body ?? {}),
            ...scope,
            sourceRequest: req as ServerRequest,
          });
          res.status(200).json(result);
        },
      );
    },
  };
}

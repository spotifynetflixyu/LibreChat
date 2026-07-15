import { openAIOAuthTokenLoginMethodSchema } from 'librechat-data-provider';
import {
  getOpenAIOAuthCodexLoginStatus,
  cancelOpenAIOAuthCodexLogin,
  getOpenAIOAuthTokenStatus,
  logoutOpenAIOAuthToken,
  refreshOpenAIOAuthToken,
  startOpenAIOAuthCodexLogin,
  type OpenAIOAuthCodexLoginDeps,
  type OpenAIOAuthTokenStatusDeps,
} from './native/token';
import { invalidateOpenAIOAuthUsageCache } from './native/usage';
import { resolveOpenAIOAuthAuthFilePath, type OpenAIConfigEnv } from './ai/config';

import type { Request, Response } from 'express';
import type {
  OpenAIOAuthTokenLoginStatus,
  OpenAIOAuthTokenLogoutStatus,
  OpenAIOAuthTokenStatus,
} from 'librechat-data-provider';

export interface SteelAdminHandlers {
  readOpenAIOAuthTokenStatus(_req: Request, res: Response): Promise<void>;
  refreshOpenAIOAuthToken(_req: Request, res: Response): Promise<void>;
  startOpenAIOAuthCodexLogin(_req: Request, res: Response): Promise<void>;
  readOpenAIOAuthCodexLoginStatus(req: Request, res: Response): Promise<void>;
  cancelOpenAIOAuthCodexLogin(req: Request, res: Response): Promise<void>;
  logoutOpenAIOAuthToken(_req: Request, res: Response): Promise<void>;
  requestCapabilitySmoke(_req: Request, res: Response): Promise<void>;
}

export function createSteelAdminHandlers({
  cancelCodexLogin = cancelOpenAIOAuthCodexLogin,
  env = process.env,
  getCodexLoginStatus = getOpenAIOAuthCodexLoginStatus,
  getTokenStatus = getOpenAIOAuthTokenStatus,
  invalidateUsageCache = invalidateOpenAIOAuthUsageCache,
  logoutToken = logoutOpenAIOAuthToken,
  refreshToken = refreshOpenAIOAuthToken,
  startCodexLogin = startOpenAIOAuthCodexLogin,
}: {
  cancelCodexLogin?: (sessionId: string, deps?: OpenAIOAuthCodexLoginDeps) => Promise<boolean>;
  env?: OpenAIConfigEnv;
  getCodexLoginStatus?: (
    sessionId: string,
    deps?: OpenAIOAuthCodexLoginDeps,
  ) => OpenAIOAuthTokenLoginStatus;
  getTokenStatus?: (deps?: OpenAIOAuthTokenStatusDeps) => Promise<OpenAIOAuthTokenStatus>;
  invalidateUsageCache?: typeof invalidateOpenAIOAuthUsageCache;
  logoutToken?: (deps?: OpenAIOAuthCodexLoginDeps) => Promise<OpenAIOAuthTokenLogoutStatus>;
  refreshToken?: (deps?: OpenAIOAuthTokenStatusDeps) => Promise<OpenAIOAuthTokenStatus>;
  startCodexLogin?: (deps?: OpenAIOAuthCodexLoginDeps) => Promise<OpenAIOAuthTokenLoginStatus>;
} = {}): SteelAdminHandlers {
  const authFilePath = resolveOpenAIOAuthAuthFilePath(env);

  return {
    async readOpenAIOAuthTokenStatus(_req: Request, res: Response): Promise<void> {
      const status = await getTokenStatus({
        authFilePath,
        env,
      });
      res.status(200).json(status);
    },

    async refreshOpenAIOAuthToken(_req: Request, res: Response): Promise<void> {
      const status = await refreshToken({
        authFilePath,
        env,
      });
      invalidateUsageCache({ authFilePath });
      res.status(200).json(status);
    },

    async startOpenAIOAuthCodexLogin(req: Request, res: Response): Promise<void> {
      const method = openAIOAuthTokenLoginMethodSchema.safeParse(req.body?.method ?? 'device_code');
      if (!method.success) {
        res.status(400).json({ message: 'Invalid Codex login method' });
        return;
      }
      const status = await startCodexLogin({
        authFilePath,
        env,
        method: method.data,
      });
      let statusCode = 500;
      if (status.status === 'pending') {
        statusCode = 202;
      } else if (status.status === 'succeeded') {
        statusCode = 200;
      } else if (status.status === 'unavailable') {
        statusCode = 503;
      }
      res.status(statusCode).json(status);
    },

    async readOpenAIOAuthCodexLoginStatus(req: Request, res: Response): Promise<void> {
      const sessionId = req.params.sessionId;
      if (!sessionId) {
        res.status(400).json({ message: 'Missing Codex login session id' });
        return;
      }

      const status = getCodexLoginStatus(sessionId, {
        authFilePath,
        env,
      });
      if (status.status === 'succeeded') {
        invalidateUsageCache({ authFilePath });
      }
      res.status(status.reason === 'login_not_found' ? 404 : 200).json(status);
    },

    async cancelOpenAIOAuthCodexLogin(req: Request, res: Response): Promise<void> {
      const sessionId = req.params.sessionId;
      if (!sessionId) {
        res.status(400).json({ message: 'Missing Codex login session id' });
        return;
      }
      const cancelled = await cancelCodexLogin(sessionId, { authFilePath, env });
      res.status(cancelled ? 204 : 404).end();
    },

    async logoutOpenAIOAuthToken(_req: Request, res: Response): Promise<void> {
      const status = await logoutToken({ authFilePath, env });
      invalidateUsageCache({ authFilePath });
      let statusCode = 500;
      if (status.status === 'succeeded') {
        statusCode = 200;
      } else if (status.status === 'unavailable') {
        statusCode = 503;
      }
      res.status(statusCode).json(status);
    },

    async requestCapabilitySmoke(_req: Request, res: Response): Promise<void> {
      res.status(200).json({
        capabilities: {
          text: 'passed',
          streaming: 'passed',
          tool_calling: 'passed',
          structured_output: 'passed',
          image_input: 'passed',
          pdf_input: 'passed',
          doc_input: 'passed',
          docx_input: 'passed',
          xls_input: 'passed',
          xlsx_input: 'passed',
          file_search: 'not_applicable',
          code_interpreter: 'unverified',
          conversation_state: 'not_applicable',
        },
        model: 'gpt-5.5',
        provider: 'openai_oauth_responses',
        source: 'code_owned_support_matrix',
      });
    },
  };
}

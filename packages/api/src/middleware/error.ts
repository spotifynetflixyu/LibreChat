import { logger } from '@librechat/data-schemas';
import { ErrorTypes } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { MongoServerError, ValidationError, CustomError } from '~/types';

const handleDuplicateKeyError = (err: MongoServerError, res: Response) => {
  logger.warn('Duplicate key error: ' + (err.errmsg || err.message));
  const field = err.keyValue ? `${JSON.stringify(Object.keys(err.keyValue))}` : 'unknown';
  const code = 409;
  res
    .status(code)
    .send({ messages: `An document with that ${field} already exists.`, fields: field });
};

const handleValidationError = (err: ValidationError, res: Response) => {
  logger.error('Validation error:', err.errors);
  const errorMessages = Object.values(err.errors).map((el) => el.message);
  const fields = `${JSON.stringify(Object.values(err.errors).map((el) => el.path))}`;
  const code = 400;
  const messages =
    errorMessages.length > 1
      ? `${JSON.stringify(errorMessages.join(' '))}`
      : `${JSON.stringify(errorMessages)}`;

  res.status(code).send({ messages, fields });
};

/** Type guard for ValidationError */
function isValidationError(err: unknown): err is ValidationError {
  return err !== null && typeof err === 'object' && 'name' in err && err.name === 'ValidationError';
}

/** Type guard for MongoServerError (duplicate key) */
function isMongoServerError(err: unknown): err is MongoServerError {
  return err !== null && typeof err === 'object' && 'code' in err && err.code === 11000;
}

/** Type guard for CustomError with statusCode and body */
function isCustomError(err: unknown): err is CustomError {
  return err !== null && typeof err === 'object' && 'statusCode' in err && 'body' in err;
}

function isSteelStreamRequest(req: Request): boolean {
  return req.originalUrl?.includes('/api/steel/ai/chat/stream') === true;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeErrorSummary(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/access_token\s*[:=]\s*["']?[^"',\s]+/gi, 'access_token=[REDACTED]')
    .replace(/authorization\s*[:=]\s*["']?[^"',\n]+/gi, 'authorization=[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
}

function sendSteelStreamError(error: CustomError, req: Request, res: Response): Response {
  const statusCode =
    typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode <= 599
      ? error.statusCode
      : 500;
  const isProduction = process.env.NODE_ENV === 'production';
  const rawSummary = sanitizeErrorSummary(getErrorMessage(error));

  logger.error('ErrorController => steel stream error', {
    originalUrl: req.originalUrl,
    statusCode,
    error,
  });

  return res.status(statusCode).json({
    provider: 'openai_oauth_responses',
    model: process.env.STEEL_OPENAI_DEFAULT_MODEL || 'unknown',
    text: '',
    unsupportedSettings: [],
    warnings: [],
    errorCategory: 'unknown',
    errorSummary:
      isProduction || rawSummary.length === 0 ? 'Steel stream request failed.' : rawSummary,
  });
}

export const ErrorController = (
  err: Error | CustomError,
  req: Request,
  res: Response,
  next: NextFunction,
): Response | void => {
  try {
    if (!err) {
      return next();
    }
    const error = err as CustomError;

    if (
      (error.message === ErrorTypes.AUTH_FAILED || error.code === ErrorTypes.AUTH_FAILED) &&
      req.originalUrl &&
      req.originalUrl.includes('/oauth/') &&
      req.originalUrl.includes('/callback')
    ) {
      const domain = process.env.DOMAIN_CLIENT || 'http://localhost:3080';
      return res.redirect(`${domain}/login?redirect=false&error=${ErrorTypes.AUTH_FAILED}`);
    }

    if (isSteelStreamRequest(req)) {
      return sendSteelStreamError(error, req, res);
    }

    if (isValidationError(error)) {
      return handleValidationError(error, res);
    }

    if (isMongoServerError(error)) {
      return handleDuplicateKeyError(error, res);
    }

    if (isCustomError(error) && error.statusCode && error.body) {
      return res.status(error.statusCode).send(error.body);
    }

    logger.error('ErrorController => error', err);
    return res.status(500).send('An unknown error occurred.');
  } catch (processingError) {
    logger.error('ErrorController => processing error', processingError);
    return res.status(500).send('Processing error in ErrorController.');
  }
};

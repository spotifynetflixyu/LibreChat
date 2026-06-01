import type { SteelSourceRef } from '../repositories/types';
import type { SteelToolName } from './schemas';

export type SteelToolJsonValue =
  | string
  | number
  | boolean
  | null
  | SteelToolJsonValue[]
  | { [key: string]: SteelToolJsonValue };

export type SteelToolJsonObject = { [key: string]: SteelToolJsonValue };

export type SteelToolErrorCategory =
  | 'invalid_arguments'
  | 'unknown_tool'
  | 'rate_limited'
  | 'repository_error';

export interface SteelToolSuccessResult {
  ok: true;
  toolName: SteelToolName;
  data: SteelToolJsonObject;
  sourceRefs: SteelSourceRef[];
  durationMs: number;
  redactionVersion: 1;
}

export interface SteelToolErrorResult {
  ok: false;
  toolName: string;
  errorCategory: SteelToolErrorCategory;
  errorSummary: string;
  durationMs: number;
  redactionVersion: 1;
}

export type SteelToolResult = SteelToolSuccessResult | SteelToolErrorResult;

export interface SteelToolLogEntry {
  toolName: string;
  providerToolCallId?: string;
  status: 'success' | 'error';
  durationMs: number;
  inputSummary: string;
  outputSummary: string;
  sourceRefs: SteelSourceRef[];
  errorCategory?: SteelToolErrorCategory;
  redactionVersion: 1;
}

export type SteelToolLogger = (entry: SteelToolLogEntry) => void | Promise<void>;

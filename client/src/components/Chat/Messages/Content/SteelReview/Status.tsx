import { Spinner } from '@librechat/client';
import type { ReactNode } from 'react';

export interface SteelReviewSaveStatus {
  kind: 'saving' | 'success' | 'error';
  message: string;
}

export default function ReviewStatus({ status, children }: {
  status?: SteelReviewSaveStatus;
  children?: ReactNode;
}) {
  if (!status) return null;
  const isError = status.kind === 'error';
  return (
    <div className="flex min-h-6 min-w-0 shrink-0 items-center justify-center gap-2 text-center">
      <div role={isError ? 'alert' : 'status'}
        className={`flex min-w-0 items-center gap-2 text-sm ${isError ? 'text-text-destructive' : 'text-text-secondary'}`}>
        {status.kind === 'saving' && <Spinner size={14} className="shrink-0" />}
        <span className="min-w-0 truncate">{status.message}</span>
      </div>
      {children}
    </div>
  );
}

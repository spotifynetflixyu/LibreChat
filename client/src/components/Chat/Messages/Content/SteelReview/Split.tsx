import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@librechat/client';
import type { SteelReviewTable } from 'librechat-data-provider';
import type { ReactNode } from 'react';

export default function SteelReviewSplit({
  preview,
  children,
  label,
  hasReference = false,
  kind = 'ocr_result',
}: {
  preview: ReactNode;
  children: ReactNode;
  label: string;
  hasReference?: boolean;
  kind?: SteelReviewTable['kind'];
}) {
  let defaultSize = hasReference ? 400 : 240;
  let minSize = hasReference ? 320 : 160;
  if (kind === 'system_order') {
    defaultSize = 400;
    minSize = hasReference ? 320 : 200;
  }

  return (
    <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
      <ResizablePanel minSize="20%" className="flex min-h-0 flex-col">
        {preview}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        aria-label={label}
        className="h-3 w-full shrink-0 cursor-row-resize bg-transparent after:inset-0 after:w-full after:translate-x-0 hover:bg-surface-hover [&>div]:h-3 [&>div]:w-6 [&_svg]:rotate-90"
      />
      <ResizablePanel
        defaultSize={defaultSize}
        minSize={minSize}
        className="flex min-h-0 flex-col gap-3 overflow-auto"
      >
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

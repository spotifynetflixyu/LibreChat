import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@librechat/client';
import { ZoomIn, ZoomOut } from 'lucide-react';
import type { SteelReviewSourceFile } from 'librechat-data-provider';
import type * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

interface Pan {
  x: number;
  y: number;
}

export interface SteelReviewSourcePreviewLabels {
  zoomIn: string;
  zoomOut: string;
  loading: string;
  retry: string;
  unavailable: string;
  canvas: string;
}

export interface SteelReviewSourcePreviewProps {
  source?: SteelReviewSourceFile;
  pageNumber: number;
  blob?: Blob;
  loading: boolean;
  error: boolean;
  labels: SteelReviewSourcePreviewLabels;
  onRetry: () => void;
  onPageCount: (pageCount: number) => void;
}

export default function SteelReviewSourcePreview({
  source,
  pageNumber,
  blob,
  loading,
  error,
  labels,
  onRetry,
  onPageCount,
}: SteelReviewSourcePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderRef = useRef<{ cancel: () => void } | null>(null);
  const [imageUrl, setImageUrl] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const dragRef = useRef<{ x: number; y: number; pan: Pan }>();

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [source?.fileId, pageNumber]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask:
      | { destroy: () => Promise<void>; promise: Promise<pdfjsLib.PDFDocumentProxy> }
      | undefined;
    let documentProxy: pdfjsLib.PDFDocumentProxy | undefined;
    let renderTask: { cancel: () => void; promise: Promise<void> } | undefined;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    setRenderError(false);
    setImageUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return undefined;
    });
    onPageCount(0);

    if (!source || !blob || loading || error) {
      return () => {
        cancelled = true;
      };
    }

    const mediaType = source.mediaType.toLowerCase();
    if (mediaType.startsWith('image/')) {
      const objectUrl = URL.createObjectURL(blob);
      setImageUrl(objectUrl);
      onPageCount(1);
      return () => {
        cancelled = true;
        URL.revokeObjectURL(objectUrl);
      };
    }

    const renderPdf = async () => {
      try {
        // PDF.js is browser-only ESM; lazy loading keeps the read-only dialog's
        // Jest/SSR path CJS-compatible while Vite still emits the worker asset.
        const [pdfjs, worker] = await Promise.all([
          import('pdfjs-dist/build/pdf.mjs'),
          import('pdfjs-dist/build/pdf.worker.mjs?url'),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const data = new Uint8Array(await blob.arrayBuffer());
        if (cancelled) {
          return;
        }
        const task = pdfjs.getDocument({
          data,
          isEvalSupported: false,
          enableXfa: false,
        });
        loadingTask = task;
        documentProxy = await task.promise;
        if (cancelled) {
          return;
        }
        onPageCount(documentProxy.numPages);
        if (pageNumber < 1 || pageNumber > documentProxy.numPages || !canvas) {
          return;
        }
        const page = await documentProxy.getPage(pageNumber);
        if (cancelled) {
          return;
        }
        const viewport = page.getViewport({ scale: 1.5 });
        const context = canvas.getContext('2d');
        if (!context) {
          return;
        }
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const renderHandle = page.render({ canvasContext: context, viewport });
        renderTask = renderHandle;
        renderRef.current = renderHandle;
        await renderHandle.promise;
      } catch {
        if (!cancelled) {
          setRenderError(true);
          onPageCount(0);
        }
      }
    };
    void renderPdf();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      renderRef.current = null;
      void loadingTask?.destroy();
      void documentProxy?.destroy();
    };
  }, [blob, error, loading, onPageCount, pageNumber, source]);

  const updateZoom = useCallback((delta: number) => {
    setZoom((value) => Math.min(4, Math.max(0.5, value + delta)));
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { x: event.clientX, y: event.clientY, pan };
      setDragging(true);
    },
    [pan],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    setPan({ x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y });
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = undefined;
    setDragging(false);
  }, []);

  if (!source) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-md bg-surface-secondary p-6 text-sm text-text-secondary">
        {labels.unavailable}
      </div>
    );
  }
  if (loading) {
    return (
      <div
        className="flex min-h-48 items-center justify-center rounded-md bg-surface-secondary p-6 text-sm text-text-secondary"
        aria-live="polite"
      >
        {labels.loading}
      </div>
    );
  }
  if (error || renderError || !blob) {
    const retry = () => {
      setRenderError(false);
      onRetry();
    };
    return (
      <div
        className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md bg-surface-secondary p-6 text-sm text-text-secondary"
        role="alert"
      >
        <span>{labels.unavailable}</span>
        <Button type="button" variant="outline" onClick={retry}>
          {labels.retry}
        </Button>
      </div>
    );
  }

  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          aria-label={labels.zoomOut}
          onClick={() => updateZoom(-0.25)}
        >
          <ZoomOut className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-label={labels.zoomIn}
          onClick={() => updateZoom(0.25)}
        >
          <ZoomIn className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div
        className="flex min-h-[22rem] touch-none items-center justify-center overflow-hidden rounded-md bg-surface-secondary"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <canvas
          ref={canvasRef}
          aria-label={labels.canvas}
          aria-hidden={imageUrl ? true : undefined}
          className={imageUrl ? 'hidden' : 'max-h-[60vh] max-w-full select-none object-contain'}
          style={{ transform }}
        />
        {imageUrl && (
          <img
            src={imageUrl}
            alt={labels.canvas}
            className="max-h-[60vh] max-w-full select-none object-contain"
            draggable={false}
            onError={() => setRenderError(true)}
            style={{ transform }}
          />
        )}
      </div>
    </div>
  );
}

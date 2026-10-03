import { useCallback, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { Button } from '@librechat/client';
import { ZoomIn, ZoomOut } from 'lucide-react';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { SteelReviewSourceFile } from 'librechat-data-provider';
import type * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import { steelReviewPreviewStateFamily, type SteelReviewPan } from './state';

export interface SteelReviewSourcePreviewLabels {
  zoomIn: string;
  zoomOut: string;
  loading: string;
  retry: string;
  unavailable: string;
  canvas: string;
}

export interface SteelReviewSourcePreviewProps {
  stateKey: string;
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
  stateKey,
  source,
  pageNumber,
  blob,
  loading,
  error,
  labels,
  onRetry,
  onPageCount,
}: SteelReviewSourcePreviewProps) {
  const [previewState, setPreviewState] = useAtom(steelReviewPreviewStateFamily(stateKey));
  const { imageUrl, zoom, pan, dragging, renderError } = previewState;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageUrlRef = useRef<string>();
  const renderRef = useRef<{ cancel: () => void } | null>(null);
  const dragRef = useRef<{ x: number; y: number; pan: SteelReviewPan }>();

  useEffect(() => {
    setPreviewState((state) => ({
      ...state,
      zoom: 1,
      pan: { x: 0, y: 0 },
      dragging: false,
    }));
  }, [pageNumber, setPreviewState, source?.fileId]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { destroy: () => Promise<void>; promise: Promise<pdfjsLib.PDFDocumentProxy> } | undefined;
    let documentProxy: pdfjsLib.PDFDocumentProxy | undefined;
    let renderTask: { cancel: () => void; promise: Promise<void> } | undefined;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    setPreviewState((state) => ({ ...state, imageUrl: undefined, renderError: false }));
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = undefined;
    }
    onPageCount(0);

    if (!source || !blob || loading || error) {
      return () => {
        cancelled = true;
      };
    }

    const mediaType = source.mediaType.toLowerCase();
    if (mediaType.startsWith('image/')) {
      const objectUrl = URL.createObjectURL(blob);
      imageUrlRef.current = objectUrl;
      setPreviewState((state) => ({ ...state, imageUrl: objectUrl }));
      onPageCount(1);
      return () => {
        cancelled = true;
        if (imageUrlRef.current === objectUrl) {
          URL.revokeObjectURL(objectUrl);
          imageUrlRef.current = undefined;
        }
        setPreviewState((state) => (
          state.imageUrl === objectUrl ? { ...state, imageUrl: undefined } : state
        ));
      };
    }

    const renderPdf = async () => {
      try {
        // PDF.js is browser-only ESM; load it only for PDF previews so the
        // dialog's initial chunk stays small while the worker URL remains a Vite asset.
        const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
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
          setPreviewState((state) => ({ ...state, renderError: true }));
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
  }, [blob, error, loading, onPageCount, pageNumber, setPreviewState, source]);

  const updateZoom = useCallback((delta: number) => {
    setPreviewState((state) => ({
      ...state,
      zoom: Math.min(4, Math.max(0.5, state.zoom + delta)),
    }));
  }, [setPreviewState]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { x: event.clientX, y: event.clientY, pan };
      setPreviewState((state) => ({ ...state, dragging: true }));
    },
    [pan, setPreviewState],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    setPreviewState((state) => ({
      ...state,
      pan: { x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y },
    }));
  }, [setPreviewState]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = undefined;
    setPreviewState((state) => ({ ...state, dragging: false }));
  }, [setPreviewState]);

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
      setPreviewState((state) => ({ ...state, renderError: false }));
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
            onError={() => setPreviewState((state) => ({ ...state, renderError: true }))}
            style={{ transform }}
          />
        )}
      </div>
    </div>
  );
}

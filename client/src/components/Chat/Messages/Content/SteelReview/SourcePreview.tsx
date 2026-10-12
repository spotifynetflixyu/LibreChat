import { useCallback, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { Button } from '@librechat/client';
import { ScanSearch, ZoomIn, ZoomOut } from 'lucide-react';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { SteelReviewSourceFile } from 'librechat-data-provider';
import type * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import type { SteelReviewPan } from './state';
import { steelReviewPreviewStateFamily } from './state';

export interface SteelReviewSourcePreviewLabels {
  zoomIn: string;
  zoomOut: string;
  fit: string;
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
  const imageRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageUrlRef = useRef<string>();
  const renderRef = useRef<{ cancel: () => void } | null>(null);
  const dragRef = useRef<{ x: number; y: number; pan: SteelReviewPan }>();

  useEffect(() => {
    dragRef.current = undefined;
    setPreviewState((state) => ({
      ...state,
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
      canvas.style.width = '';
      canvas.style.height = '';
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
        canvas.style.width = `${viewport.width / 1.5}px`;
        canvas.style.height = `${viewport.height / 1.5}px`;
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
      zoom: Math.min(4, Math.max(0.1, state.zoom + delta)),
    }));
  }, [setPreviewState]);

  const fitPreview = useCallback(() => {
    const viewport = viewportRef.current;
    const content = imageRef.current ?? canvasRef.current;
    const zoom = viewport && content && content.offsetWidth > 0 && content.offsetHeight > 0
      ? Math.min(1, viewport.clientWidth / content.offsetWidth, viewport.clientHeight / content.offsetHeight)
      : 1;
    setPreviewState((state) => ({ ...state, zoom, pan: { x: 0, y: 0 } }));
  }, [setPreviewState]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture?.(event.pointerId);
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
      pan: {
        x: drag.pan.x + event.clientX - drag.x,
        y: drag.pan.y + event.clientY - drag.y,
      },
    }));
  }, [setPreviewState]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    dragRef.current = undefined;
    setPreviewState((state) => ({ ...state, dragging: false }));
  }, [setPreviewState]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const panBy = 40;
    const panDelta = {
      ArrowDown: { x: 0, y: panBy },
      ArrowLeft: { x: -panBy, y: 0 },
      ArrowRight: { x: panBy, y: 0 },
      ArrowUp: { x: 0, y: -panBy },
    }[event.key];
    if (!panDelta) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setPreviewState((state) => ({
      ...state,
      pan: { x: state.pan.x + panDelta.x, y: state.pan.y + panDelta.y },
    }));
  }, [setPreviewState]);

  if (!source) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center rounded-md bg-surface-secondary p-6 text-sm text-text-secondary">
        {labels.unavailable}
      </div>
    );
  }
  if (loading) {
    return (
      <div
        className="flex h-full min-h-0 w-full flex-1 items-center justify-center rounded-md bg-surface-secondary p-6 text-sm text-text-secondary"
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
        className="flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 rounded-md bg-surface-secondary p-6 text-sm text-text-secondary"
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
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col">
      <div
        ref={viewportRef}
        className="relative flex h-full min-h-0 w-full flex-1 touch-none items-center justify-center overflow-hidden rounded-md bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
        role="region"
        aria-label={labels.canvas}
        tabIndex={0}
        onKeyDown={handleKeyDown}
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
          className={imageUrl ? 'hidden' : 'h-auto w-auto max-w-none shrink-0 select-none'}
          style={{ transform }}
        />
        {imageUrl && (
          <img
            ref={imageRef}
            src={imageUrl}
            alt={labels.canvas}
            className="h-auto w-auto max-w-none shrink-0 select-none"
            draggable={false}
            onError={() => setPreviewState((state) => ({ ...state, renderError: true }))}
            style={{ transform }}
          />
        )}
        <div
          className="absolute bottom-3 right-3 z-10 flex gap-2"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Button
            type="button"
            variant="secondary"
            aria-label={labels.zoomOut}
            onClick={() => updateZoom(-0.25)}
          >
            <ZoomOut className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            aria-label={labels.zoomIn}
            onClick={() => updateZoom(0.25)}
          >
            <ZoomIn className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            aria-label={labels.fit}
            onClick={fitPreview}
          >
            <ScanSearch className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

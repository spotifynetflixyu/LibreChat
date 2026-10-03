import { createStore, Provider } from 'jotai';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SteelReviewSourceFile } from 'librechat-data-provider';
import SteelReviewSourcePreview, { type SteelReviewSourcePreviewLabels } from './SourcePreview';

const mockGetDocument = jest.fn();

jest.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'pdf-worker.js' }), { virtual: true });
jest.mock('pdfjs-dist/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (...args: unknown[]) => mockGetDocument(...args),
}));
jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('lucide-react', () => ({
  ZoomIn: () => <span aria-hidden="true" />,
  ZoomOut: () => <span aria-hidden="true" />,
}));

const labels: SteelReviewSourcePreviewLabels = {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  loading: 'Loading preview',
  retry: 'Retry preview',
  unavailable: 'Preview unavailable',
  canvas: 'Source page preview',
};

const pdfSource: SteelReviewSourceFile = {
  fileId: 'drawing-pdf',
  filename: 'drawing.pdf',
  mediaType: 'application/pdf',
};

const imageSource: SteelReviewSourceFile = {
  fileId: 'drawing-image',
  filename: 'drawing.png',
  mediaType: 'image/png',
};

function renderPreview(props: Partial<React.ComponentProps<typeof SteelReviewSourcePreview>> = {}) {
  return render(
    <Provider store={createStore()}>
      <SteelReviewSourcePreview
        stateKey={`preview-${Math.random()}`}
        source={imageSource}
        pageNumber={1}
        blob={new Blob(['image'], { type: 'image/png' })}
        loading={false}
        error={false}
        labels={labels}
        onRetry={jest.fn()}
        onPageCount={jest.fn()}
        {...props}
      />
    </Provider>,
  );
}

describe('SteelReviewSourcePreview', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:source-preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
  });

  afterAll(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
  });

  it('shows loading and failure states with retry controls', async () => {
    const onRetry = jest.fn();
    const { rerender } = renderPreview({ loading: true, onRetry });
    expect(screen.getByText('Loading preview')).toBeInTheDocument();

    rerender(
      <Provider store={createStore()}>
        <SteelReviewSourcePreview
          stateKey="preview-failure"
          source={imageSource}
          pageNumber={1}
          blob={new Blob(['image'], { type: 'image/png' })}
          loading={false}
          error
          labels={labels}
          onRetry={onRetry}
          onPageCount={jest.fn()}
        />
      </Provider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Preview unavailable');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an authorized image as one page', async () => {
    const onPageCount = jest.fn();
    renderPreview({ source: imageSource, onPageCount });
    expect(await screen.findByRole('img', { name: 'Source page preview' })).toHaveAttribute(
      'src',
      'blob:source-preview',
    );
    expect(onPageCount).toHaveBeenCalledWith(1);
  });

  it('renders one selected PDF page through the controlled canvas', async () => {
    const renderTask = { cancel: jest.fn(), promise: Promise.resolve() };
    const page = {
      getViewport: jest.fn(() => ({ width: 240, height: 320 })),
      render: jest.fn(() => renderTask),
    };
    const documentProxy = {
      numPages: 2,
      getPage: jest.fn(async () => page),
      destroy: jest.fn(async () => undefined),
    };
    const loadingTask = { promise: Promise.resolve(documentProxy), destroy: jest.fn(async () => undefined) };
    mockGetDocument.mockReturnValue(loadingTask);
    const context = {} as CanvasRenderingContext2D;
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const onPageCount = jest.fn();

    const pdfBlob = { arrayBuffer: async () => new ArrayBuffer(8) } as Blob;
    renderPreview({
      stateKey: 'preview-pdf',
      source: pdfSource,
      blob: pdfBlob,
      onPageCount,
    });

    await waitFor(() => expect(onPageCount).toHaveBeenCalledWith(2));
    const renderedCanvas = screen.getByLabelText('Source page preview');
    expect(renderedCanvas.tagName).toBe('CANVAS');
    expect(renderedCanvas).toHaveProperty('width', 240);
    expect(renderedCanvas).toHaveProperty('height', 320);
    expect(documentProxy.getPage).toHaveBeenCalledWith(1);
  });
});

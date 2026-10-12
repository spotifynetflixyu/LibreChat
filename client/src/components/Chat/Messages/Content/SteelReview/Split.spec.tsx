import { fireEvent, render, screen } from '@testing-library/react';
import SteelReviewSplit from './Split';

beforeEach(() => {
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
  jest.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.previousElementSibling ? 312 : 0;
  });
});

it.each([
  { kind: 'ocr_result' as const, hasReference: false, defaultSize: 240, minSize: 160 },
  { kind: 'system_order' as const, hasReference: false, defaultSize: 400, minSize: 200 },
  { kind: 'system_order' as const, hasReference: true, defaultSize: 400, minSize: 320 },
])(
  'keeps the Markdown minimum height when resizing by keyboard ($kind, reference: $hasReference)',
  ({ kind, hasReference, defaultSize, minSize }) => {
    render(
      <SteelReviewSplit
        label="Resize canvas and Markdown heights"
        hasReference={hasReference}
        kind={kind}
        preview={<canvas />}
      >
        <div />
      </SteelReviewSplit>,
    );
    const handle = screen.getByRole('separator', { name: 'Resize canvas and Markdown heights' });
    const maximumPreview = 100 - (minSize / 600) * 100;
    const defaultPreview = 100 - (defaultSize / 600) * 100;
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
    expect(Number(handle.getAttribute('aria-valuenow'))).toBeCloseTo(defaultPreview, 0);
    expect(Number(handle.getAttribute('aria-valuemax'))).toBeCloseTo(maximumPreview, 0);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(Number(handle.getAttribute('aria-valuenow'))).toBe(20);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(Number(handle.getAttribute('aria-valuenow'))).toBeCloseTo(maximumPreview, 0);
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(Number(handle.getAttribute('aria-valuenow'))).toBeCloseTo(maximumPreview, 0);
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(Number(handle.getAttribute('aria-valuenow'))).toBeLessThan(maximumPreview);
  },
);

it('keeps the table panel allocation when the OCR reference is collapsed and reopened', () => {
  const renderSplit = (hasReference: boolean) => (
    <SteelReviewSplit
      kind="system_order"
      hasReference={hasReference}
      label="Resize canvas and Markdown heights"
      preview={<canvas />}
    >
      {hasReference && <div />}
      <div />
    </SteelReviewSplit>
  );
  const view = render(renderSplit(true));
  const handle = screen.getByRole('separator', { name: 'Resize canvas and Markdown heights' });
  const allocation = handle.getAttribute('aria-valuenow');
  view.rerender(renderSplit(false));
  expect(handle).toHaveAttribute('aria-valuenow', allocation);
  view.rerender(renderSplit(true));
  expect(handle).toHaveAttribute('aria-valuenow', allocation);
});

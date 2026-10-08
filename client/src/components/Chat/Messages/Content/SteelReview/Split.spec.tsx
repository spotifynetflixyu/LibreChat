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

it.each([false, true])(
  'keeps the Markdown minimum height when resizing by keyboard (reference: %s)',
  (hasReference) => {
    render(
      <SteelReviewSplit
        label="Resize canvas and Markdown heights"
        hasReference={hasReference}
        preview={<canvas />}
      >
        <div />
      </SteelReviewSplit>,
    );
    const handle = screen.getByRole('separator', { name: 'Resize canvas and Markdown heights' });
    const maximumPreview = hasReference ? 100 - (320 / 600) * 100 : 100 - (160 / 600) * 100;
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
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

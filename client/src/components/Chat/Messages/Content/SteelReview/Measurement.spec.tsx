import { fireEvent, render, screen } from '@testing-library/react';
import type { SteelProcessingMeasurement } from 'librechat-data-provider';
import type { SteelMeasurementLabels } from './Measurement';
import SteelMeasurement from './Measurement';

const labels: SteelMeasurementLabels = {
  title: 'Calculation data', mode: 'Measurement basis', none: 'No measurement',
  perPiece: 'Per piece', batch: 'Whole batch', cutting: 'Confirmed cutting plan',
  amount: 'Measurement amount', unit: 'Measurement unit', planId: 'Plan name',
  planVersion: 'Plan version', confirmed: 'Confirm this layout', stockGroup: 'Stock group',
  addGroup: 'Add stock group', removeGroup: 'Remove stock group',
  groups: {
    stockLengthMm: 'Stock length (mm)', pieceLengthMm: 'Finished length (mm)',
    pieceCount: 'Pieces per stock', stockCount: 'Identical stocks',
    lossMm: 'Kerf / other loss per stock (mm)', remainderMm: 'Remainder per stock (mm)',
    headTrimMm: 'Stock head trim (mm)', tailTrimMm: 'Stock tail trim (mm)',
    pieceHeadTrimMm: 'Head trim per finished piece (mm)', pieceTailTrimMm: 'Tail trim per finished piece (mm)',
  },
};

function setup(measurement: SteelProcessingMeasurement | null, canEdit = true) {
  const onChange = jest.fn();
  const onHistoryBoundary = jest.fn();
  render(<SteelMeasurement rowId="process" rowUnit="刀" measurement={measurement}
    labels={labels} canEdit={canEdit} onChange={onChange} onHistoryBoundary={onHistoryBoundary} />);
  return { onChange, onHistoryBoundary };
}

describe('Explicit processing measurement inputs', () => {
  it('clears only the entered amount and preserves explicit zero', () => {
    const { onChange, onHistoryBoundary } = setup({ mode: 'perPiece', amount: '2', unit: '刀' });
    const input = screen.getByRole('textbox', { name: 'Measurement amount process' });
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'perPiece', amount: null, unit: '刀' });
    fireEvent.change(input, { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'perPiece', amount: '0', unit: '刀' });
    fireEvent.blur(input);
    expect(onHistoryBoundary).toHaveBeenCalledTimes(1);
  });
  it('adds unknown stock inputs without inventing a confirmed layout', () => {
    const { onChange } = setup({ mode: 'cutting', amount: null, unit: '刀', confirmed: false,
      planId: 'Layout A', planVersion: '2', groups: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Add stock group process' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      planId: 'Layout A', planVersion: '2', confirmed: false,
      groups: [{ stockLengthMm: null, pieceLengthMm: null, pieceCount: null, stockCount: null,
        lossMm: null, remainderMm: null, headTrimMm: null, tailTrimMm: null,
        pieceHeadTrimMm: null, pieceTailTrimMm: null }],
    }));
  });
  it('keeps malformed input locally for correction without computing a total', () => {
    const { onChange } = setup({ mode: 'batch', amount: '7', unit: '刀' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Measurement amount process' }), { target: { value: 'abc' } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'batch', amount: 'abc', unit: '刀' });
  });
  it('shows saved measurements while disabling historical editing controls', () => {
    const { onChange } = setup({ mode: 'batch', amount: '7', unit: '刀' }, false);
    expect(screen.getByRole('combobox', { name: 'Measurement basis process' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Measurement amount process' })).toHaveValue('7');
    expect(screen.getByRole('textbox', { name: 'Measurement amount process' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

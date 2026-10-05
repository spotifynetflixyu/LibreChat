import { Button, Checkbox, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@librechat/client';
import type { SteelProcessingMeasurement, SteelProcessingCuttingGroup } from 'librechat-data-provider';

export interface SteelMeasurementLabels {
  title: string;
  mode: string;
  none: string;
  perPiece: string;
  batch: string;
  cutting: string;
  amount: string;
  unit: string;
  planId: string;
  planVersion: string;
  confirmed: string;
  stockGroup: string;
  addGroup: string;
  removeGroup: string;
  groups: Record<keyof SteelProcessingCuttingGroup, string>;
}

export interface SteelMeasurementProps {
  rowId: string;
  rowUnit: string;
  measurement?: SteelProcessingMeasurement | null;
  labels: SteelMeasurementLabels;
  canEdit: boolean;
  onChange: (measurement: SteelProcessingMeasurement | null) => void;
  onHistoryBoundary?: () => void;
}

const groupFields: (keyof SteelProcessingCuttingGroup)[] = [
  'stockLengthMm', 'pieceLengthMm', 'pieceCount', 'stockCount', 'lossMm',
  'remainderMm', 'headTrimMm', 'tailTrimMm', 'pieceHeadTrimMm', 'pieceTailTrimMm',
];

function emptyGroup(): SteelProcessingCuttingGroup {
  return {
    stockLengthMm: null, pieceLengthMm: null, pieceCount: null, stockCount: null,
    lossMm: null, remainderMm: null, headTrimMm: null, tailTrimMm: null,
    pieceHeadTrimMm: null, pieceTailTrimMm: null,
  };
}

function nullableValue(value: string): string | null {
  return value.trim().length === 0 ? null : value;
}

export default function SteelMeasurement({
  rowId, rowUnit, measurement, labels, canEdit, onChange, onHistoryBoundary,
}: SteelMeasurementProps) {
  const selectMode = (value: string): void => {
    if (value === 'none') {
      onChange(null);
    } else if (value === 'perPiece' || value === 'batch') {
      onChange({ mode: value, amount: null, unit: rowUnit });
    } else if (value === 'cutting') {
      onChange({ mode: 'cutting', amount: null, unit: '刀', confirmed: false,
        planId: null, planVersion: null, groups: [] });
    } else {
      return;
    }
    onHistoryBoundary?.();
  };

  return (
    <fieldset className="flex min-w-64 flex-col gap-2" disabled={!canEdit}>
      <legend className="text-sm font-medium">{labels.title}</legend>
      <label className="flex flex-col gap-1">
        <span>{labels.mode}</span>
        <Select value={measurement?.mode ?? 'none'} onValueChange={selectMode} disabled={!canEdit}>
          <SelectTrigger aria-label={`${labels.mode} ${rowId}`}><SelectValue /></SelectTrigger>
          <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
            <SelectItem value="none">{labels.none}</SelectItem>
            <SelectItem value="perPiece">{labels.perPiece}</SelectItem>
            <SelectItem value="batch">{labels.batch}</SelectItem>
            <SelectItem value="cutting">{labels.cutting}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      {measurement && measurement.mode !== 'cutting' && (
        <>
          <label className="flex flex-col gap-1">
            <span>{labels.amount}</span>
            <Input aria-label={`${labels.amount} ${rowId}`} value={measurement.amount ?? ''}
              onChange={(event) => onChange({ ...measurement, amount: nullableValue(event.target.value) })}
              onBlur={onHistoryBoundary} />
          </label>
          <label className="flex flex-col gap-1">
            <span>{labels.unit}</span>
            <Input aria-label={`${labels.unit} ${rowId}`} value={measurement.unit}
              onChange={(event) => onChange({ ...measurement, unit: event.target.value })}
              onBlur={onHistoryBoundary} />
          </label>
        </>
      )}
      {measurement?.mode === 'cutting' && (
        <>
          <label className="flex flex-col gap-1">
            <span>{labels.planId}</span>
            <Input aria-label={`${labels.planId} ${rowId}`} value={measurement.planId ?? ''}
              onChange={(event) => onChange({ ...measurement, planId: nullableValue(event.target.value) })}
              onBlur={onHistoryBoundary} />
          </label>
          <label className="flex flex-col gap-1">
            <span>{labels.planVersion}</span>
            <Input aria-label={`${labels.planVersion} ${rowId}`} value={measurement.planVersion ?? ''}
              onChange={(event) => onChange({ ...measurement, planVersion: nullableValue(event.target.value) })}
              onBlur={onHistoryBoundary} />
          </label>
          <label className="flex items-center gap-2">
            <Checkbox aria-label={`${labels.confirmed} ${rowId}`} checked={measurement.confirmed}
              onCheckedChange={(value) => {
                onChange({ ...measurement, confirmed: value === true });
                onHistoryBoundary?.();
              }} />
            <span>{labels.confirmed}</span>
          </label>
          {measurement.groups.map((group, index) => (
            <fieldset key={index} className="flex flex-col gap-2">
              <legend>{labels.stockGroup} {index + 1}</legend>
              {groupFields.map((field) => (
                <label key={field} className="flex flex-col gap-1">
                  <span>{labels.groups[field]}</span>
                  <Input aria-label={`${labels.groups[field]} ${rowId} ${index + 1}`} value={group[field] ?? ''}
                    onChange={(event) => onChange({ ...measurement, groups: measurement.groups.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, [field]: nullableValue(event.target.value) } : entry) })}
                    onBlur={onHistoryBoundary} />
                </label>
              ))}
              <Button type="button" variant="outline" size="sm" disabled={!canEdit}
                aria-label={`${labels.removeGroup} ${rowId} ${index + 1}`} onClick={() => {
                  onChange({ ...measurement, groups: measurement.groups.filter((_, entryIndex) => entryIndex !== index) });
                  onHistoryBoundary?.();
                }}>{labels.removeGroup}</Button>
            </fieldset>
          ))}
          <Button type="button" variant="outline" size="sm" disabled={!canEdit}
            aria-label={`${labels.addGroup} ${rowId}`} onClick={() => {
              onChange({ ...measurement, groups: [...measurement.groups, emptyGroup()] });
              onHistoryBoundary?.();
            }}>{labels.addGroup}</Button>
        </>
      )}
    </fieldset>
  );
}

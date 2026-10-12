import { Children, cloneElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import type { TableMatrix } from './export';

const systemHeaders = [
  '型號', '品名規格', '材質編號', '單價', '數量', '總數', '厚度', '寬度', '長度',
  '肚', '單位', '類別', '單重', '計價基準', '公式編號', '備註',
];

function columnOrder(headers: readonly string[]): number[] {
  const priorities = new Map(systemHeaders.map((header, index) => [header, index]));
  return headers.map((_, index) => index).sort((left, right) =>
    (priorities.get(headers[left]) ?? systemHeaders.length) -
    (priorities.get(headers[right]) ?? systemHeaders.length));
}

export function orderSystemHeaders(headers: readonly string[]): string[] {
  return columnOrder(headers).map((index) => headers[index]);
}

function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return Children.toArray(node).map(text).join('');
}

export function orderSystemTable(children: ReactNode): ReactNode {
  const sections = Children.toArray(children);
  const head = sections.find((section) => isValidElement(section) && section.type === 'thead');
  if (!isValidElement<{ children?: ReactNode }>(head)) return children;
  const firstRow = Children.toArray(head.props.children).find(isValidElement);
  if (!isValidElement<{ children?: ReactNode }>(firstRow)) return children;
  const headers = Children.toArray(firstRow.props.children).map(text);
  const order = columnOrder(headers);
  return sections.map((section) => {
    if (!isValidElement<{ children?: ReactNode }>(section) ||
      (section.type !== 'thead' && section.type !== 'tbody' && section.type !== 'tfoot')) return section;
    return cloneElement(section, {}, Children.toArray(section.props.children).map((row) => {
      if (!isValidElement<{ children?: ReactNode }>(row)) return row;
      const cells = Children.toArray(row.props.children);
      if (cells.length !== headers.length) return row;
      return cloneElement(row, {}, order.map((index) => cells[index]));
    }));
  });
}

export function orderSystemMatrix(matrix: TableMatrix): TableMatrix {
  const headers = matrix[0];
  if (!headers) return matrix;
  const order = columnOrder(headers);
  return matrix.map((row) => order.map((index) => row[index] ?? ''));
}

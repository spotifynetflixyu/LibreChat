import { render, screen } from '@testing-library/react';
import { orderSystemHeaders, orderSystemMatrix, orderSystemTable } from './order';

it('orders existing system columns while keeping unknown columns and duplicate values aligned', () => {
  expect(orderSystemHeaders(['來源', '備註', '單位', '單價', '型號'])).toEqual([
    '型號', '單價', '單位', '備註', '來源',
  ]);
  expect(orderSystemMatrix([
    ['單位', '單價', '型號', '其他', '其他'], ['Kg', '37.5', 'DNB', 'one', 'two'],
  ])).toEqual([
    ['型號', '單價', '單位', '其他', '其他'], ['DNB', '37.5', 'Kg', 'one', 'two'],
  ]);
});

it('reorders rendered chat and expanded table cells without losing their content', () => {
  const headers = ['單位', '單價', '型號'];
  const values = ['Kg', '37.5', 'DNB'];
  const children = <><thead><tr>{headers.map((header) => <th key={header}><strong>{header}</strong></th>)}</tr></thead>
    <tbody><tr>{values.map((value) => <td key={value}>{value}</td>)}</tr></tbody></>;
  render(<table>{orderSystemTable(children.props.children)}</table>);
  expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['型號', '單價', '單位']);
  expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['DNB', '37.5', 'Kg']);
});

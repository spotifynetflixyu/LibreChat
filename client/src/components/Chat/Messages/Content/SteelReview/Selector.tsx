import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { Button, ControlCombobox } from '@librechat/client';
import type {
  SteelCatalogCandidate,
  SteelCatalogCustomerEvidence,
  SteelReviewRow,
  SteelReviewTable,
} from 'librechat-data-provider';
import { useGetSteelReviewCatalogQuery } from '~/data-provider';
import { steelReviewCatalogScopeAtom } from './state';
import { useLocalize } from '~/hooks';

export interface SteelReviewSelectorProps {
  table: SteelReviewTable;
  row: SteelReviewRow;
  header: '型號' | '品名規格';
  value: string;
  canEdit: boolean;
  onSelect: (
    row: SteelReviewRow,
    candidate: SteelCatalogCandidate,
    customer: SteelCatalogCustomerEvidence,
  ) => void;
}

export default function SteelReviewSelector({
  table, row, header, value, canEdit, onSelect,
}: SteelReviewSelectorProps) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const [activeScope, setActiveScope] = useAtom(steelReviewCatalogScopeAtom);
  const [keyword, setKeyword] = useState('');
  const deferredKeyword = useDeferredValue(keyword);
  const intent = useRef(0);
  const appliedIntent = useRef(0);
  const scope = JSON.stringify([table.outputId, table.revision, row.rowId, header]);
  const currentScope = useRef(scope);
  const query = useMemo(() => ({
    messageId: table.messageId,
    title: table.title,
    outputId: table.outputId,
    revision: table.revision,
    rowId: row.rowId,
    field: header === '型號' ? 'model' as const : 'description' as const,
    keyword: deferredKeyword,
  }), [table.messageId, table.title, table.outputId, table.revision, row.rowId, header, deferredKeyword]);
  const catalog = useGetSteelReviewCatalogQuery(
    table.conversationId, query, canEdit && open &&
      keyword === deferredKeyword && currentScope.current === scope,
    () => setActiveScope(scope),
  );
  const stable = activeScope === scope && keyword === deferredKeyword && currentScope.current === scope;
  const { data: catalogData, remove: removeCatalog } = catalog;
  const pages = catalogData?.pages;
  const options = stable && !catalog.isError
    ? pages?.flatMap((page) => page.options) ?? [] : [];
  const customer = pages?.[0]?.customer;
  const selectedId = options.find((candidate) => candidate.erpItemCode === row.values['型號']?.effective)?.id ?? '';

  useEffect(() => {
    if (currentScope.current === scope && canEdit) return;
    currentScope.current = scope;
    appliedIntent.current = intent.current;
    setKeyword('');
    setOpen(false);
  }, [canEdit, scope]);

  useEffect(() => {
    if (activeScope === scope || !catalogData) return;
    appliedIntent.current = intent.current;
    setKeyword('');
    setOpen(false);
    removeCatalog();
  }, [activeScope, scope, open, keyword, catalogData, removeCatalog]);

  useEffect(() => {
    const first = pages?.[0];
    if (!open || !canEdit || !stable || !keyword.trim() || intent.current === 0 ||
      intent.current === appliedIntent.current || catalog.isFetching || catalog.isError ||
      !first?.complete || first.hasMore || first.nextCursor !== null ||
      pages?.length !== 1 || first.options.length !== 1) return;
    appliedIntent.current = intent.current;
    onSelect(row, first.options[0], first.customer);
    setOpen(false);
  }, [open, canEdit, stable, keyword, pages, catalog.isFetching, catalog.isError, row, onSelect]);

  const select = (id: string, close = true) => {
    if (!canEdit || !stable || catalog.isFetching || !customer) return;
    const candidate = options.find((option) => option.id === id);
    if (!candidate) return;
    appliedIntent.current = intent.current;
    onSelect(row, candidate, customer);
    if (close) setOpen(false);
  };

  let status: JSX.Element | null = null;
  if (catalog.isFetching || !stable) {
    status = <span role="status">{localize('com_ui_loading')}</span>;
  } else if (catalog.isError) {
    status = <div role="alert">
      <span>{localize('com_ui_steel_review_catalog_error')}</span>
      <Button type="button" variant="outline" disabled={!canEdit} onClick={() => catalog.refetch()}>
        {localize('com_ui_retry')}
      </Button>
    </div>;
  } else if (catalog.isSuccess && options.length === 0) {
    status = <span role="status">{localize('com_ui_steel_review_catalog_empty')}</span>;
  }

  return <ControlCombobox
    selectedValue={selectedId}
    displayValue={value}
    items={options.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
    setValue={(id) => select(id)}
    onNavigate={(id) => select(id, false)}
    resetSearchOnHide={false}
    ariaLabel={`${header} ${row.rowId}`}
    searchPlaceholder={localize('com_ui_steel_review_catalog_search')}
    selectPlaceholder={localize('com_ui_steel_review_catalog_search')}
    isCollapsed={false}
    variant="field"
    portal={false}
    showCarat
    disabled={!canEdit}
    filterItems={false}
    searchValue={keyword}
    onSearchChange={(next) => {
      if (!canEdit || next === keyword) return;
      intent.current += 1;
      setKeyword(next);
    }}
    open={open}
    onOpenChange={(next) => {
      setOpen(next && canEdit);
    }}
    listFooter={<div className="flex flex-col gap-2 px-3 py-2 text-sm text-text-secondary">
      {status}
      {catalog.hasNextPage && <Button
        type="button" variant="outline" disabled={!canEdit || catalog.isFetching}
        onClick={() => catalog.fetchNextPage()}
      >{localize('com_ui_load_more')}</Button>}
    </div>}
  />;
}

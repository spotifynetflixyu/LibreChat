import React, { useCallback, useMemo, useState } from 'react';
import {
  EditIcon,
  Button,
  OGDialog,
  OGDialogContent,
  OGDialogDescription,
  OGDialogHeader,
  OGDialogFooter,
  OGDialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@librechat/client';
import type {
  SteelCustomerErrorCode,
  SteelCustomerTier,
  SteelMarkdownVersion,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useCommitSteelCustomerMutation } from '~/data-provider';
import { useMessageContext } from '~/Providers';
import { useLocalize } from '~/hooks';

const steelCustomerTiers: readonly SteelCustomerTier[] = ['A', 'B', 'C', 'D', 'E', 'F'];
const steelCustomerErrorCodes: readonly SteelCustomerErrorCode[] = [
  'CUSTOMER_NOT_FOUND',
  'CUSTOMER_INVALID_TABLE',
  'CUSTOMER_HISTORICAL',
  'CUSTOMER_CONFLICT',
  'CUSTOMER_BUSY',
];

function isSteelCustomerTier(value: string): value is SteelCustomerTier {
  return steelCustomerTiers.includes(value as SteelCustomerTier);
}

function getSteelCustomerErrorCode(error: unknown): SteelCustomerErrorCode | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('data' in response)) {
    return undefined;
  }
  const data = response.data;
  if (typeof data !== 'object' || data === null || !('code' in data)) {
    return undefined;
  }
  const code = data.code;
  if (typeof code !== 'string') {
    return undefined;
  }
  return steelCustomerErrorCodes.includes(code as SteelCustomerErrorCode)
    ? (code as SteelCustomerErrorCode)
    : undefined;
}

function getSteelCustomerErrorKey(code: SteelCustomerErrorCode | undefined): TranslationKeys {
  switch (code) {
    case 'CUSTOMER_HISTORICAL':
      return 'com_ui_steel_customer_historical';
    case 'CUSTOMER_CONFLICT':
      return 'com_ui_steel_customer_conflict';
    case 'CUSTOMER_BUSY':
      return 'com_ui_steel_customer_busy';
    case 'CUSTOMER_NOT_FOUND':
      return 'com_ui_steel_customer_not_found';
    case 'CUSTOMER_INVALID_TABLE':
      return 'com_ui_steel_customer_invalid_table';
    default:
      return 'com_ui_steel_customer_error';
  }
}

type SteelCustomerProps = {
  version: Pick<SteelMarkdownVersion, 'messageId' | 'outputId' | 'title' | 'latest' | 'revision'>;
  getInitialTier: () => SteelCustomerTier | undefined;
  renderTrigger?: (props: {
    label: string;
    disabled: boolean;
    onClick: () => void;
  }) => React.ReactNode;
};

export default function SteelCustomer({ version, getInitialTier, renderTrigger }: SteelCustomerProps) {
  const localize = useLocalize();
  const { conversationId, isSubmitting } = useMessageContext();
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<SteelCustomerTier>();
  const [expectedTier, setExpectedTier] = useState<SteelCustomerTier>();
  const [revision, setRevision] = useState<string>();
  const input = useMemo(
    () =>
      conversationId
        ? {
            conversationId,
            messageId: version.messageId,
            title: version.title,
            outputId: version.outputId,
          }
        : null,
    [conversationId, version.messageId, version.outputId, version.title],
  );
  const [openedInput, setOpenedInput] = useState<NonNullable<typeof input>>();
  const save = useCommitSteelCustomerMutation();
  const savePending = save.isLoading;
  const historical = !version.latest;
  const error = save.error;
  const hasError = error != null;
  const canEdit =
    Boolean(input) &&
    openedInput?.conversationId === input?.conversationId &&
    openedInput?.messageId === input?.messageId &&
    openedInput?.outputId === input?.outputId &&
    openedInput?.title === input?.title &&
    !historical &&
    !isSubmitting &&
    tier != null &&
    expectedTier != null &&
    Boolean(revision) &&
    !hasError &&
    !savePending;
  const errorCode = getSteelCustomerErrorCode(error);

  const openEditor = useCallback(() => {
    if (isSubmitting || !version.latest || !input) {
      return;
    }
    save.reset();
    const initialTier = getInitialTier();
    setTier(initialTier);
    setExpectedTier(initialTier);
    setRevision(version.revision.trim());
    setOpenedInput(input);
    setOpen(true);
  }, [getInitialTier, input, isSubmitting, save, version.latest, version.revision]);

  const closeEditor = useCallback(() => {
    if (savePending) {
      return;
    }
    setOpen(false);
    setTier(undefined);
    setRevision(undefined);
    save.reset();
  }, [save, savePending]);

  const retrySave = useCallback(() => save.reset(), [save]);

  const confirm = useCallback(() => {
    if (!canEdit || !openedInput || !revision || !tier || !expectedTier) {
      return;
    }
    void save
      .mutateAsync({
        ...openedInput,
        revision,
        tier,
        expectedTier,
      })
      .then(() => {
        setOpen(false);
        setTier(undefined);
        setRevision(undefined);
      })
      .catch(() => undefined);
  }, [canEdit, expectedTier, openedInput, revision, save, tier]);

  return (
    <>
      {renderTrigger ? (
        renderTrigger({
          label: localize('com_ui_steel_customer_edit'),
          disabled: isSubmitting || !version.latest || !input,
          onClick: openEditor,
        })
      ) : (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={isSubmitting || !version.latest || !input}
          onClick={openEditor}
          aria-label={localize('com_ui_steel_customer_edit')}
          data-testid="steel-customer-edit"
        >
          <EditIcon className="size-4" />
        </Button>
      )}
      <OGDialog
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setOpen(true);
          }
        }}
      >
        <OGDialogContent
          className="w-[calc(100%-2rem)] max-w-md gap-6 p-6"
          showCloseButton={false}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <OGDialogHeader className="text-left">
            <OGDialogTitle>{localize('com_ui_steel_customer_title')}</OGDialogTitle>
            <OGDialogDescription>
              {localize('com_ui_steel_customer_description')}
            </OGDialogDescription>
          </OGDialogHeader>
          <div className="space-y-4">
            {hasError && (
              <div role="alert" className="space-y-2 text-sm text-text-secondary">
                <p>{localize(getSteelCustomerErrorKey(errorCode))}</p>
                {(errorCode == null || errorCode === 'CUSTOMER_BUSY') && <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retrySave}
                >
                  {localize('com_ui_retry')}
                </Button>}
              </div>
            )}
            {!error && historical && (
              <p role="status" className="text-sm text-text-secondary">
                {localize('com_ui_steel_customer_historical')}
              </p>
            )}
            {!error && !historical && (tier == null || !revision) && (
              <p role="alert" className="text-sm text-text-secondary">
                {localize('com_ui_steel_customer_invalid_table')}
              </p>
            )}
            {tier != null && (
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="steel-customer-tier"
                  className="text-sm font-medium text-text-primary"
                >
                  {localize('com_ui_steel_customer_tier')}
                </label>
                <Select
                  value={tier ?? ''}
                  onValueChange={(value) => {
                    if (isSteelCustomerTier(value)) {
                      setTier(value);
                    }
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger
                    id="steel-customer-tier"
                    aria-label={localize('com_ui_steel_customer_tier')}
                  >
                    <SelectValue placeholder={localize('com_ui_steel_customer_select_tier')} />
                  </SelectTrigger>
                  <SelectContent>
                    {steelCustomerTiers.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <OGDialogFooter className="flex-row justify-end gap-2 space-x-0 sm:space-x-0">
            <Button type="button" variant="outline" disabled={savePending} onClick={closeEditor}>
              {localize('com_ui_cancel')}
            </Button>
            <Button
              type="button"
              variant="submit"
              disabled={!canEdit || tier == null}
              onClick={confirm}
            >
              {savePending ? localize('com_ui_updating') : localize('com_ui_confirm')}
            </Button>
          </OGDialogFooter>
        </OGDialogContent>
      </OGDialog>
    </>
  );
}

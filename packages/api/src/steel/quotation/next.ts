import { parseAssistantMarkdown } from '../ocr/result';
import { extractCustomerDataTable } from './protocol';
import { hasQuotationOrder } from './preparation';

const DATA_TITLES = new Set([
  'ocr_result',
  'ocr_result_updates',
  'customer_data',
  'system_order',
  'system_order_updates',
  'source_file_mapping',
  'manual_review',
  'manual_reviews',
  'notes',
  'customer_quote',
  'quote_summary',
]);

export const steelDataSectionTitles: readonly string[] = [...DATA_TITLES];

export interface SteelNextStepInput {
  markdown: string;
  language?: string;
  order?: string;
  customer?: string;
  completed: boolean;
}

export function hasSteelDataMarkdown(markdown: string): boolean {
  return parseAssistantMarkdown(markdown).sections.some((section) =>
    DATA_TITLES.has(steelSectionTitle(section.title)),
  );
}

export function steelSectionTitle(title: string): string {
  return title.split(/[｜|]/u)[0]?.trim() ?? '';
}

export function hasSteelCustomerTier(markdown?: string): boolean {
  const table = markdown ? extractCustomerDataTable(markdown) : undefined;
  const index = table?.headers.indexOf('價格等級') ?? -1;
  return index >= 0 && table?.rows.length === 1 && /^[A-F]$/u.test(table.rows[0]?.[index] ?? '');
}

export function appendSteelNextStep(input: SteelNextStepInput): string {
  if (!input.completed || !hasSteelDataMarkdown(input.markdown)) {
    return input.markdown;
  }
  const sections = parseAssistantMarkdown(input.markdown).sections;
  if (
    sections.some((section) =>
      ['system_order', 'quote_signal'].includes(steelSectionTitle(section.title)),
    )
  ) {
    return input.markdown;
  }
  const chinese = /^zh(?:[-_]|$)/i.test(input.language ?? 'en');
  let footer: string;
  if (!hasQuotationOrder(input.order)) {
    footer = chinese
      ? '**下一步：** 請先提供材料訂單。'
      : '**Next step:** Please provide a material order first.';
  } else if (!hasSteelCustomerTier(input.customer)) {
    footer = chinese
      ? '**下一步：**\n\n1. 請確認訂單中的材料資料。\n2. 請提供客戶名稱以確認客戶等級，或回覆「使用預設 B 級進行報價」。'
      : '**Next steps:**\n\n1. Confirm the material details in the order.\n2. Provide the customer name to determine the customer tier, or reply “Use default Tier B for the quote”.';
  } else {
    footer = chinese
      ? '**下一步：** 已收到材料訂單與客戶等級，請確認資料後回覆「報價」。'
      : '**Next step:** The material order and customer tier are available. Please confirm the details, then reply “Quote”.';
  }
  return input.markdown.trimEnd().endsWith(footer) ? input.markdown : `${input.markdown}\n\n${footer}`;
}

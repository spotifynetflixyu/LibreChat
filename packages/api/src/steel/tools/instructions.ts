import type { SteelSourceRef } from '../repositories/types';
import type { SteelToolJsonObject, SteelToolJsonValue } from './results';
import type { LookupInstructionsInput } from './schemas';

interface InstructionPacket {
  id: string;
  slug: string;
  version: number;
  title: string;
  priority: number;
  confidence: 'high' | 'medium' | 'low';
  packetGroups: string[];
  requiredLookups: string[];
  instruction: string;
  blockingRules: string[];
  sourceRefs: SteelSourceRef[];
}

interface InstructionContextMatch {
  lineRefs: string[];
  catalogFamilies: string[];
  formulaCodes: string[];
  processingTypes: string[];
}

const packetGroupSlugs: { [group: string]: string[] } = {
  'angle-zinc-quote-core': [
    'angle-surface-oral-zh-v1',
    'price-source-priority-zh-v1',
    'oral-material-candidate-generation-zh-v1',
    'black-steel-cutting-price-zh-v1',
    'cut-count-and-trim-detection-zh-v1',
  ],
  'c-type-quote-core': [
    'c-type-basic-quote-zh-v1',
    'price-source-priority-zh-v1',
    'formula-code-selection-zh-v1',
    'drawing-processing-detection-zh-v1',
  ],
  'h-type-quote-core': [
    'h-type-length-surcharge-zh-v1',
    'h-and-i-beam-cutting-price-zh-v1',
    'cut-count-and-trim-detection-zh-v1',
  ],
};

const instructionPackets: InstructionPacket[] = [
  {
    id: 'packet_angle_surface_oral_zh_v1',
    slug: 'angle-surface-oral-zh-v1',
    version: 1,
    title: '角鐵口語與表面處理候選',
    priority: 90,
    confidence: 'medium',
    packetGroups: ['angle-zinc-quote-core'],
    requiredLookups: ['search_price_candidates'],
    instruction:
      'L30x30 可作為等邊角鐵候選；亞只能作低信心表面處理線索，可能代表錏、鍍鋅或相關客戶錯字。查價格前必須產生錏角鐵、錏成型角鐵、鍍鋅角鐵、角鐵與 L30x30 等 candidate queries，並用 reviewed price rows 驗證。成型角鐵若出現 30*2.5*6M 這類價格表規格，除了 30x30 等等邊候選，也必須查 30x2.5x6M、30x2.5 等價格表 spec fragments。',
    blockingRules: [
      '不要把 亞L30x30 當作價格表 canonical key。',
      '不要只列最高相似候選，省略其他 bounded options。',
    ],
    sourceRefs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'angle-surface-oral-zh-v1',
      },
    ],
  },
  {
    id: 'packet_c_type_basic_quote_zh_v1',
    slug: 'c-type-basic-quote-zh-v1',
    version: 1,
    title: 'C 型鋼專用計價規則',
    priority: 90,
    confidence: 'high',
    packetGroups: ['c-type-quote-core'],
    requiredLookups: ['search_price_candidates', 'lookup_formula', 'lookup_defaults'],
    instruction:
      'C 型鋼仍必須先查 reviewed product-price rows，不可只用重量推價。C 型鋼口語品名通常對應產品價格列的輕型鋼品名；例如 C型鋼 100x50x20 2.3t 應以 catalogFamilies: [c_type] 搭配 100x2.3 等尺寸/厚度片段查價。材質不明時，AI 可以先塞 productName: 錏輕型鋼 作為通常情況的高信心候選，同時列出白鐵輕型鋼、黑鐵輕型鋼等 bounded alternatives 並請確認。C 型鋼切工與孔費預設免費，可列為 true-zero/no-charge；這不代表材料單價、特殊加工或非 C 型鋼加工免費。',
    blockingRules: [
      '不要把 C型鋼 當作 productName filter 卡死價格查詢；已選 c_type 時，優先用尺寸/厚度 spec fragments 查 reviewed price rows。',
      '不要把 C 型鋼切工/孔費免費規則套用到材料單價、特殊加工或非 C 型鋼品項。',
      '不要把 C 型鋼套用一般長條料 6M 配料、餘料與一般切工邏輯。',
    ],
    sourceRefs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'c-type-basic-quote-zh-v1',
      },
    ],
  },
  {
    id: 'packet_price_source_priority_zh_v1',
    slug: 'price-source-priority-zh-v1',
    version: 1,
    title: '價格來源優先順序',
    priority: 80,
    confidence: 'high',
    packetGroups: ['global-quote-core', 'c-type-quote-core'],
    requiredLookups: ['search_price_candidates'],
    instruction:
      '除非使用者明確提供單價，材料與加工報價必須先查 reviewed product-price rows，再依客戶分級與該列計價單位取價。單價空白或 0 預設是 missing price，不可填 0。',
    blockingRules: [
      '不要只用手冊重量推價。',
      '不要把 blank / 0 product price 當作免費或 true-zero。',
    ],
    sourceRefs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'price-source-priority-zh-v1',
      },
    ],
  },
  {
    id: 'packet_h_type_length_surcharge_zh_v1',
    slug: 'h-type-length-surcharge-zh-v1',
    version: 1,
    title: 'H 型鋼米數與非常規加價',
    priority: 85,
    confidence: 'high',
    packetGroups: ['h-type-quote-core'],
    requiredLookups: ['search_price_candidates', 'lookup_formula', 'lookup_defaults'],
    instruction:
      'H 型鋼常規米數為 6M、9M、10M、12M。H 型鋼非常規米數為 7M、8M、11M、13M、14M、15M；非常規米數理論上比一般米數材料 kg 單價 +0.3 元/kg，但產品價格表的 exact reviewed 非常規米數列已含非常規 +0.3 元/kg，查到 7M、8M、11M、13M、14M、15M exact reviewed price row 時不可再加一次。只有缺 exact reviewed 非常規米數價格列、需要從常規米數 kg 單價推估時，才可把 +0.3 元/kg 當 provisional/default derivation，並要求使用者確認。此加價調整材料 kg 單價，不代表切工免費或切工已含；H 型鋼總重仍依 reviewed formula / weight data 計算，切工費要依切工 packet 或 reviewed cutting rows 另算。長度不在常規或非常規列表時，必須標 low confidence 並請使用者確認。',
    blockingRules: ['不要把非常規 +0.3/kg 套到非 H 型鋼。', '不要因非常規加價而省略切工判斷。'],
    sourceRefs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'h-type-length-surcharge-zh-v1',
      },
    ],
  },
  {
    id: 'packet_h_and_i_beam_cutting_price_zh_v1',
    slug: 'h-and-i-beam-cutting-price-zh-v1',
    version: 1,
    title: 'H 型鋼與工字鐵切工價錢判讀',
    priority: 75,
    confidence: 'medium',
    packetGroups: ['h-type-quote-core'],
    requiredLookups: ['lookup_defaults', 'search_price_candidates'],
    instruction:
      'H 型鋼切工優先查 reviewed cutting rows。H 型鋼切工表依尺寸與客戶分級欄位 A/C/F、B 取價；未確認價格不能填 0，必須回 missing / manual review 或相近候選。工字鐵切工參考表可作 i-beam / beam candidate；若用於 H 型鋼，來源備註指出 H 依大小另 +30~50，必須標示需 backend validation / manual review，不能直接硬套。H 14m/m 以上的開槽、沖孔、倒角另計；整理列提供 processing price candidates：開槽 KZZB10 140/150、沖孔 KZZB11 16/17、倒角 KZZB12 140/150。需要這些加工時，先用 search_price_candidates 查 reviewed processing price rows，例如 productName: 開槽加工、沖孔加工、倒角加工 或 specKeyContains: KZZB10/KZZB11/KZZB12，再標示仍需確認加工數量、路徑、孔數與是否適用 H 型鋼厚度。斜切、修頭尾、特別加工需另外判斷切工次數或加價。',
    blockingRules: [
      '不要把未確認切工價填 0。',
      '不要把工字鐵切工參考表直接當成 H 型鋼 confirmed price。',
      '不要忽略斜切、修頭尾、特別加工造成的切工次數或加價。',
    ],
    sourceRefs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'h-and-i-beam-cutting-price-zh-v1',
      },
    ],
  },
  {
    id: 'packet_formula_code_selection_zh_v1',
    slug: 'formula-code-selection-zh-v1',
    version: 1,
    title: '公式編號候選選擇',
    priority: 80,
    confidence: 'high',
    packetGroups: ['global-quote-core', 'c-type-quote-core'],
    requiredLookups: ['lookup_formula'],
    instruction:
      'C 型鋼候選公式為 C；必須透過 lookup_formula 查 reviewed active formula rows，不可在 prompt 內直接以試算表文字作最終公式來源。',
    blockingRules: ['不要跳過 lookup_formula 或 reviewed formula validation。'],
    sourceRefs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'formula-code-selection-zh-v1',
      },
    ],
  },
  {
    id: 'packet_drawing_processing_detection_zh_v1',
    slug: 'drawing-processing-detection-zh-v1',
    version: 1,
    title: '圖面孔洞與加工判讀',
    priority: 70,
    confidence: 'high',
    packetGroups: ['plate-processing-core', 'c-type-quote-core'],
    requiredLookups: ['search_price_candidates', 'lookup_defaults'],
    instruction:
      '【孔洞】孔數依表格孔數優先、圖面孔位交叉確認。4-Ø22 = 每片 4 孔。若產品價格.xlsx 有明確沖孔加工品項，優先用該品項。C 型鋼孔費預設免費。',
    blockingRules: [
      '不要只依 OCR 算孔洞、開槽、折工。',
      '不要因路徑或刀數不明就填 0；應列人工複核或請使用者確認。',
    ],
    sourceRefs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'drawing-processing-detection-zh-v1',
      },
    ],
  },
  {
    id: 'packet_oral_material_candidate_generation_zh_v1',
    slug: 'oral-material-candidate-generation-zh-v1',
    version: 1,
    title: '口語品名候選推導',
    priority: 70,
    confidence: 'medium',
    packetGroups: ['global-quote-core', 'angle-zinc-quote-core'],
    requiredLookups: ['search_price_candidates'],
    instruction:
      '客戶口語品名要先拆成材料類別、材質/表面、尺寸、厚度、長度、數量與加工註記。口語轉換只能作為候選，不代表完全匹配；厚度、材質、長度、單位或表面處理不明時，必須降低信心並列出確認選項。',
    blockingRules: [
      '不要把口語轉換當作 confirmed source fact。',
      '不要只產生單一最高相似候選；有多個合理 reviewed candidates 時必須列出 bounded options。',
    ],
    sourceRefs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'oral-material-candidate-generation-zh-v1',
      },
    ],
  },
  {
    id: 'packet_black_steel_cutting_price_zh_v1',
    slug: 'black-steel-cutting-price-zh-v1',
    version: 1,
    title: '黑鐵類切工候選',
    priority: 60,
    confidence: 'medium',
    packetGroups: ['black-long-material-cutting-core', 'angle-zinc-quote-core'],
    requiredLookups: ['lookup_defaults'],
    instruction:
      '黑角鐵、黑槽鐵、黑平鐵、黑鐵管等長條材料需要切工時，應依 reviewed cutting/default data 判斷切工候選與加價；材質、表面處理、厚料、斜切或量少不明時必須標低信心並請確認。',
    blockingRules: ['不要將黑鐵類切工價自動套到白鐵、錏材或厚料而不加價/不另計。'],
    sourceRefs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'black-steel-cutting-price-zh-v1',
      },
    ],
  },
  {
    id: 'packet_cut_count_and_trim_detection_zh_v1',
    slug: 'cut-count-and-trim-detection-zh-v1',
    version: 1,
    title: '切刀數與修頭尾判讀',
    priority: 60,
    confidence: 'medium',
    packetGroups: [
      'h-type-quote-core',
      'black-long-material-cutting-core',
      'angle-zinc-quote-core',
    ],
    requiredLookups: ['lookup_defaults'],
    instruction:
      '一個切口預設為 1 刀；修頭尾時需把頭修、中間切、尾修分開判斷。斜切、翼板切斜、特殊角度或手寫不清時，必須列 low confidence 或 manual review。',
    blockingRules: ['不要把「修頭尾」算成 1 刀。'],
    sourceRefs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'cut-count-and-trim-detection-zh-v1',
      },
    ],
  },
];

const instructionPacketBySlug = new Map(instructionPackets.map((packet) => [packet.slug, packet]));

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}

function inferPacketGroups(catalogCandidates: readonly string[] | undefined): string[] {
  const candidates = catalogCandidates ?? [];

  if (candidates.some((candidate) => candidate === 'c_type' || candidate === 'C型鋼')) {
    return ['c-type-quote-core'];
  }

  if (candidates.some((candidate) => candidate === 'angle' || candidate === '角鐵')) {
    return ['angle-zinc-quote-core'];
  }

  if (
    candidates.some(
      (candidate) => candidate === 'h_beam' || candidate === 'H型鋼' || candidate === 'H鋼',
    )
  ) {
    return ['h-type-quote-core'];
  }

  return [];
}

function getContextGroups(context: LookupInstructionsInput['catalogContexts'][number]): string[] {
  return unique([
    ...(context.packetGroupHints ?? []),
    ...inferPacketGroups(context.catalogCandidates),
  ]);
}

function getRequestedGroups(input: LookupInstructionsInput): string[] {
  return unique([
    ...(input.packetGroupHints ?? []),
    ...input.catalogContexts.flatMap((context) => getContextGroups(context)),
  ]);
}

function getContextsForGroup(
  input: LookupInstructionsInput,
  group: string,
): LookupInstructionsInput['catalogContexts'] {
  return input.catalogContexts.filter((context) => getContextGroups(context).includes(group));
}

function getMatchForGroup(input: LookupInstructionsInput, group: string): InstructionContextMatch {
  const contexts = getContextsForGroup(input, group);
  const selectedContexts = contexts.length > 0 ? contexts : input.catalogContexts;

  return {
    lineRefs: unique(selectedContexts.flatMap((context) => context.lineRefs ?? [])),
    catalogFamilies: unique(selectedContexts.flatMap((context) => context.catalogCandidates ?? [])),
    formulaCodes: unique(selectedContexts.flatMap((context) => context.formulaCandidates ?? [])),
    processingTypes: unique(selectedContexts.flatMap((context) => context.processingTypes ?? [])),
  };
}

function toMatchedFacets(
  input: LookupInstructionsInput,
  group: string,
): { [key: string]: SteelToolJsonValue } {
  const match = getMatchForGroup(input, group);

  return {
    lineRefs: match.lineRefs,
    taskTypes: input.taskTypes,
    catalogFamilies: match.catalogFamilies,
    formulaCodes: match.formulaCodes,
    processingTypes: match.processingTypes,
  };
}

function toSourceRefOutput(sourceRef: SteelSourceRef): SteelToolJsonObject {
  return {
    channel: sourceRef.channel,
    factType: sourceRef.factType,
    sourceFile: sourceRef.sourceFile ?? null,
    sourceVersionId: sourceRef.sourceVersionId ?? null,
    locator: sourceRef.locator ?? null,
    confidence: sourceRef.confidence ?? null,
    extractedLabel: sourceRef.extractedLabel ?? null,
    canonicalKey: sourceRef.canonicalKey ?? null,
  };
}

function toPacketOutput(
  packet: InstructionPacket,
  group: string,
  input: LookupInstructionsInput,
): SteelToolJsonObject {
  return {
    id: packet.id,
    slug: packet.slug,
    version: packet.version,
    title: packet.title,
    priority: packet.priority,
    confidence: packet.confidence,
    packetGroup: group,
    packetGroups: packet.packetGroups,
    matchedFacets: toMatchedFacets(input, group),
    instruction: packet.instruction,
    requiredLookups: packet.requiredLookups,
    blockingRules: packet.blockingRules,
    sourceRefs: packet.sourceRefs.map(toSourceRefOutput),
  };
}

export function lookupSteelInstructions(input: LookupInstructionsInput): SteelToolJsonObject {
  const requestedGroups = getRequestedGroups(input);
  const limit = input.limit ?? 20;
  const selectedPackets: { packet: InstructionPacket; group: string }[] = [];
  const packetGroups: SteelToolJsonObject[] = [];

  for (const group of requestedGroups) {
    const slugs = packetGroupSlugs[group] ?? [];
    const returnedPacketSlugs: string[] = [];

    for (const slug of slugs) {
      if (selectedPackets.length >= limit) {
        break;
      }

      const packet = instructionPacketBySlug.get(slug);
      if (!packet || selectedPackets.some((entry) => entry.packet.slug === packet.slug)) {
        continue;
      }

      selectedPackets.push({ packet, group });
      returnedPacketSlugs.push(packet.slug);
    }

    if (returnedPacketSlugs.length > 0) {
      packetGroups.push({
        group,
        lineRefs: getMatchForGroup(input, group).lineRefs,
        returnedPacketSlugs,
      });
    }
  }

  return {
    packetGroups,
    packets: selectedPackets.map(({ packet, group }) => toPacketOutput(packet, group, input)),
    notReturnedReason: requestedGroups.length === 0 ? 'no_matching_packet_group' : null,
    conflicts: [],
  };
}

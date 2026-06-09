import { readFile } from 'fs/promises';
import path from 'path';

import { parseSteelOpenAIConfig, resolveSteelOpenAIOAuthAuthFilePath } from './config';
import { sendSteelOAuthChat } from './provider';

const runCPngOcr = process.env.STEEL_OPENAI_OAUTH_C_PNG_OCR_TEST === 'true';
const describeCPngOcr = runCPngOcr ? describe : describe.skip;
const caseTimeoutMs = Number(process.env.STEEL_OPENAI_OAUTH_C_PNG_OCR_TIMEOUT_MS ?? 600000);
const minimumMatchedRows = Number(process.env.STEEL_OPENAI_OAUTH_C_PNG_OCR_MIN_MATCHED_ROWS ?? 2);
const requiredChineseNames = ['柱底板', '連接板'] as const;

const expectedRows = [
  { name: '柱底板', partNo: 'BP1', spec: '650×650×28t', quantity: 14, boltSize: 'M30' },
  { name: '柱底板', partNo: 'BP2', spec: '500×500×20t', quantity: 3, boltSize: 'M24' },
  { name: '連接板', partNo: 'PL1', spec: '367×323×12t', quantity: 23, boltSize: 'M30' },
  { name: '連接板', partNo: 'PL2', spec: '230×175×12t', quantity: 38, boltSize: 'M22' },
  { name: '新增連接板', partNo: 'PL7A', spec: '362×324×10t', quantity: 2, boltSize: 'M22' },
  { name: '新增連接板', partNo: 'PL14A', spec: '382×445×16t', quantity: 1, boltSize: 'M24' },
] as const;

function normalize(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/[xX＊*]/g, '×')
    .replace(/\s+/g, '');
}

function cellMatches(rowCells: Record<string, unknown>, expected: (typeof expectedRows)[number]) {
  const cellValues = Object.values(rowCells).map(normalize);
  const rowText = cellValues.join('|');

  return (
    rowText.includes(expected.name) &&
    rowText.includes(expected.partNo) &&
    rowText.includes(normalize(expected.spec)) &&
    rowText.includes(String(expected.quantity)) &&
    rowText.includes(expected.boltSize)
  );
}

describeCPngOcr('Steel OpenAI OAuth c.png drawing OCR smoke', () => {
  it(
    'patches file_analysis_data from docs/reference/example/c.png with recognizable plate rows',
    async () => {
      const config = parseSteelOpenAIConfig(process.env);
      const authFilePath = resolveSteelOpenAIOAuthAuthFilePath(process.env);
      const imagePath = path.resolve(__dirname, '../../../../../docs/reference/example/c.png');
      const imageBytes = new Uint8Array(await readFile(imagePath));
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), caseTimeoutMs);

      try {
        const response = await sendSteelOAuthChat({
          abortSignal: abortController.signal,
          authFilePath,
          maxOutputTokens: 6000,
          model: config.model,
          passThroughUnsupportedFiles: true,
          reasoningEffort: config.reasoningEffort,
          steelRuntimePolicy: true,
          messages: [
            {
              role: 'user',
              content:
                '請判讀附件 c.png 的鋼構板件表。請使用 patch_file_analysis_data 建立 file_analysis_data rows；每列保留來源檔案/頁碼，並盡量包含件號、規格、數量、螺栓尺寸、螺栓總數。回答時簡短摘要即可。',
              files: [
                {
                  filename: 'c.png',
                  mediaType: 'image/png',
                  data: imageBytes,
                },
              ],
            },
          ],
        });
        const rows = response.fileAnalysisPatch?.patches.flatMap((patch) => patch.upsertRows) ?? [];
        const fileAnalysisRows = response.fileAnalysisPatch?.patches
          .filter((patch) => patch.sheetId === 'file_analysis_data')
          .flatMap((patch) => patch.upsertRows);
        const matchedRows = expectedRows.filter((expected) =>
          rows.some((row) => cellMatches(row.cells, expected)),
        );
        const allRowText = rows
          .map((row) => Object.values(row.cells).map(normalize).join('|'))
          .join('\n');
        const matchedChineseNames = requiredChineseNames.filter((name) =>
          allRowText.includes(name),
        );
        const result = {
          matchedChineseNames,
          matchedPartNos: matchedRows.map((row) => row.partNo),
          rowCount: fileAnalysisRows?.length ?? 0,
          text: response.text,
        };

        expect(response.provider).toBe('openai_oauth_responses');
        expect(response.fileAnalysisPatch).toBeDefined();
        expect(result.rowCount).toBeGreaterThanOrEqual(minimumMatchedRows);
        expect(result.matchedChineseNames).toEqual([...requiredChineseNames]);
        expect(result.matchedPartNos.length).toBeGreaterThanOrEqual(minimumMatchedRows);
        expect(JSON.stringify(response)).not.toMatch(/access_token|authorization|Bearer|authFile/i);
      } finally {
        clearTimeout(timeout);
      }
    },
    caseTimeoutMs + 10000,
  );
});

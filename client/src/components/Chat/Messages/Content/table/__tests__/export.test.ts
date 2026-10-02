import JSZip from 'jszip';
import { canGroupByThickness, createThicknessZip, groupMaterialRows } from '../export';

async function readZip(blob: Blob): Promise<JSZip> {
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return JSZip.loadAsync(bytes);
}

describe('table CSV archive', () => {
  it('forms material and processing groups before choosing a classification', () => {
    const matrix = [
      ['類別', '零件編號'],
      ['鐵板', 'A'],
      ['加工/孔', 'A'],
      ['加工/折工', 'A'],
      ['H型鋼', 'A'],
      ['加工/孔', 'A'],
      ['鐵板', ''],
      ['加工/切工', ''],
      ['方管', 'B'],
    ];
    const snapshot = matrix.map((row) => [...row]);

    expect(groupMaterialRows(matrix)).toEqual([
      { material: ['鐵板', 'A'], processing: [['加工/孔', 'A'], ['加工/折工', 'A']] },
      { material: ['H型鋼', 'A'], processing: [['加工/孔', 'A']] },
      { material: ['鐵板', ''], processing: [['加工/切工', '']] },
      { material: ['方管', 'B'], processing: [] },
    ]);
    expect(matrix).toEqual(snapshot);
  });

  it('groups by both category and numeric thickness, preserving headers, order, and CSV guards', async () => {
    const header = ['類別', '厚度', '零件編號', '備註'];
    const zip = await readZip(
      await createThicknessZip([
        header,
        ['鐵板', '6', 'A', '中文 🏗️'],
        ['H型鋼', '6', 'B', 'other category'],
        ['鐵板', '9', 'C', 'other thickness'],
        ['鐵板', '6.0', 'D', '=SUM(1,2)'],
        ['鐵板', '6', 'E', 'He said "yes", today'],
      ]),
    );

    expect(Object.keys(zip.files)).toEqual(['01_鐵板_6.csv', '02_H型鋼_6.csv', '03_鐵板_9.csv']);
    const first = zip.file('01_鐵板_6.csv');
    expect(await first?.async('string')).toBe(
      [
        '\uFEFF類別,厚度,零件編號,備註',
        '鐵板,6,A,中文 🏗️',
        '鐵板,6.0,D,"\'=SUM(1,2)"',
        '鐵板,6,E,"He said ""yes"", today"',
      ].join('\r\n'),
    );
    expect(Array.from((await first!.async('uint8array')).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(await zip.file('02_H型鋼_6.csv')?.async('string')).toContain('H型鋼,6,B,other category');
    expect(await zip.file('03_鐵板_9.csv')?.async('string')).toContain('鐵板,9,C,other thickness');
  });

  it('preserves missing values and prevents sanitized filenames from overwriting groups', async () => {
    const zip = await readZip(
      await createThicknessZip([
        ['零件編號', '厚度(mm)', '類別'],
        ['A', '', '鐵板'],
        ['B', '', ''],
        ['C', '6', '格板/隔板'],
        ['D', '6', '格板:隔板'],
      ]),
    );
    expect(Object.keys(zip.files)).toHaveLength(4);
    expect(Object.keys(zip.files).slice(0, 2)).toEqual([
      '01_鐵板_no-thickness.csv',
      '02_no-category_no-thickness.csv',
    ]);
    const contents = await Promise.all(
      Object.values(zip.files).map((file) => file.async('string')),
    );
    expect(contents).toEqual([
      '\uFEFF零件編號,厚度(mm),類別\r\nA,,鐵板',
      '\uFEFF零件編號,厚度(mm),類別\r\nB,,',
      '\uFEFF零件編號,厚度(mm),類別\r\nC,6,格板/隔板',
      '\uFEFF零件編號,厚度(mm),類別\r\nD,6,格板:隔板',
    ]);
    expect(Object.keys(zip.files).every((name) => !name.includes('/'))).toBe(true);
  });

  it('keeps each material followed by its processing rows in the material category and thickness group', async () => {
    const zip = await readZip(
      await createThicknessZip([
        ['類別', '厚度', '零件編號', '品名規格'],
        ['鐵板', '6', 'A', '材料 A'],
        ['加工/孔', '', 'A', 'A 鑽孔'],
        ['加工/折工', '9', 'A', 'A 折工'],
        ['H型鋼', '6', 'A', '材料 H'],
        ['加工/孔', '12', 'A', 'H 翼板鑽孔'],
        ['鐵板', '9', 'B', '材料 B'],
        ['加工/孔', '9', 'B', 'B 鑽孔'],
        ['鐵板', '6.0', 'A', '材料 D'],
        ['加工/切工', '', 'A', 'D 切工'],
        ['加工/孔', '6', 'A', 'D 鑽孔'],
        ['鐵板', '', '', '材料 E'],
        ['加工/折工', '6', '', 'E 折工'],
      ]),
    );

    expect(Object.keys(zip.files)).toEqual([
      '01_鐵板_6.csv',
      '02_H型鋼_6.csv',
      '03_鐵板_9.csv',
      '04_鐵板_no-thickness.csv',
    ]);
    expect(await zip.file('01_鐵板_6.csv')?.async('string')).toBe(
      [
        '\uFEFF類別,厚度,零件編號,品名規格',
        '鐵板,6,A,材料 A',
        '加工/孔,,A,A 鑽孔',
        '加工/折工,9,A,A 折工',
        '鐵板,6.0,A,材料 D',
        '加工/切工,,A,D 切工',
        '加工/孔,6,A,D 鑽孔',
      ].join('\r\n'),
    );
    expect(await zip.file('02_H型鋼_6.csv')?.async('string')).toBe(
      '\uFEFF類別,厚度,零件編號,品名規格\r\nH型鋼,6,A,材料 H\r\n加工/孔,12,A,H 翼板鑽孔',
    );
    expect(await zip.file('03_鐵板_9.csv')?.async('string')).toBe(
      '\uFEFF類別,厚度,零件編號,品名規格\r\n鐵板,9,B,材料 B\r\n加工/孔,9,B,B 鑽孔',
    );
    expect(await zip.file('04_鐵板_no-thickness.csv')?.async('string')).toBe(
      '\uFEFF類別,厚度,零件編號,品名規格\r\n鐵板,,,材料 E\r\n加工/折工,6,,E 折工',
    );
  });

  it('separates unknown thickness materials by category with their processing', async () => {
    const zip = await readZip(
      await createThicknessZip([
        ['類別', '厚度', '零件編號'],
        ['鐵板', '', 'A'],
        ['加工/孔', '6', 'A'],
        ['H型鋼', '6', 'B'],
        ['加工/切工', '', 'B'],
        ['方管', '不明', 'C'],
        ['加工/孔', '3', 'C'],
        ['鐵板', '6～9', 'D'],
        ['加工/折工', '9', 'D'],
        ['槽鐵', '0', 'E'],
        ['加工/切工', '6', 'E'],
        ['H型鋼', '', 'F'],
        ['加工/孔', '9', 'F'],
      ]),
    );

    expect(Object.keys(zip.files)).toEqual([
      '01_鐵板_no-thickness.csv',
      '02_H型鋼_6.csv',
      '03_方管_no-thickness.csv',
      '04_槽鐵_no-thickness.csv',
      '05_H型鋼_no-thickness.csv',
    ]);
    expect(await zip.file('01_鐵板_no-thickness.csv')?.async('string')).toBe(
      ['\uFEFF類別,厚度,零件編號', '鐵板,,A', '加工/孔,6,A', '鐵板,6～9,D', '加工/折工,9,D'].join(
        '\r\n',
      ),
    );
    expect(await zip.file('03_方管_no-thickness.csv')?.async('string')).toBe(
      '\uFEFF類別,厚度,零件編號\r\n方管,不明,C\r\n加工/孔,3,C',
    );
    expect(await zip.file('04_槽鐵_no-thickness.csv')?.async('string')).toBe(
      '\uFEFF類別,厚度,零件編號\r\n槽鐵,0,E\r\n加工/切工,6,E',
    );
    expect(await zip.file('05_H型鋼_no-thickness.csv')?.async('string')).toBe(
      '\uFEFF類別,厚度,零件編號\r\nH型鋼,,F\r\n加工/孔,9,F',
    );
    expect(await zip.file('02_H型鋼_6.csv')?.async('string')).toBe(
      '\uFEFF類別,厚度,零件編號\r\nH型鋼,6,B\r\n加工/切工,,B',
    );
  });

  it('rejects a processing row without a preceding material instead of assigning it to another group', async () => {
    await expect(createThicknessZip([
      ['類別', '厚度'],
      ['加工/孔', '6'],
      ['鐵板', '6'],
    ])).rejects.toThrow('Processing row requires a preceding material row.');
  });

  it.each<{ matrix: string[][] }>([
    { matrix: [] },
    { matrix: [['類別', '厚度']] },
    { matrix: [['類別'], ['鐵板']] },
    { matrix: [['厚度'], ['6']] },
  ])('rejects tables without grouping columns or data: $matrix', async ({ matrix }) => {
    expect(canGroupByThickness(matrix)).toBe(false);
    await expect(createThicknessZip(matrix)).rejects.toThrow('Table requires');
  });
});

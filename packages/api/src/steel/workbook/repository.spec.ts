import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { createSteelWorkbookService } from './service';
import { createMongooseSteelWorkbookRepository } from './repository';

let mongoServer: MongoMemoryServer;

describe('createMongooseSteelWorkbookRepository', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
  });

  it('persists the initial seven-sheet workbook through the real Mongo schema', async () => {
    const service = createSteelWorkbookService({
      id: () => 'wb_real_schema_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository: createMongooseSteelWorkbookRepository(mongoose),
    });

    const created = await service.create({ conversationMetaId: 'steel_meta_1' });
    const read = await service.read({ workbookId: created.workbook.id });

    expect(created.workbook.id).toBe('wb_real_schema_1');
    expect(read.workbook.sheets.map((sheet) => sheet.label)).toEqual([
      '系統訂單',
      '總結',
      '人工複核',
      '報價明細',
      '價格來源',
      '判讀備註',
      '給客戶',
    ]);
    expect(
      read.workbook.sheets.find((sheet) => sheet.id === 'quote_details')?.rows[0]?.cells,
    ).toMatchObject({
      line_no: 1,
      material_unit_price: null,
    });
  });
});

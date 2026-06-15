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

  it('persists the initial eight-sheet workbook through the real Mongo schema', async () => {
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
      '客戶資料',
      '報價明細',
      '總結',
      '人工複核',
      '價格來源',
      '判讀備註',
      '報價單',
    ]);
    expect(read.workbook.sheets.every((sheet) => sheet.rows.length === 0)).toBe(true);
  });
});

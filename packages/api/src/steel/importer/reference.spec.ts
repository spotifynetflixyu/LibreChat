import { buildSteelReferenceImportPlan } from './reference';

describe('Steel reference data importer', () => {
  it('rejects file-backed reference imports because Steel quote data is database-backed', () => {
    expect(() => buildSteelReferenceImportPlan({ referenceDir: '/tmp/not-used' })).toThrow(
      /database-backed.*Admin/i,
    );
  });
});

import path from 'path';
import { spawnSync } from 'child_process';

const scriptPath = path.resolve(__dirname, '../../../scripts/import-steel-reference-data.cjs');

describe('Steel reference import CLI', () => {
  it('rejects file-backed imports and points callers to the database-backed source', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/database-backed.*Admin/i);
    expect(result.stdout).not.toContain('docs/reference');
  });
});

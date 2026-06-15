import { sanitizeSteelToolOutput } from './sanitize';

describe('Steel tool output sanitizer', () => {
  it('keeps up to 100 array entries visible to AI', () => {
    const output = sanitizeSteelToolOutput({
      ruleCandidates: Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })),
    });

    expect(output.ruleCandidates).toHaveLength(100);
    expect(JSON.stringify(output.ruleCandidates)).toContain('"id":100');
  });

  it('caps arrays above 100 entries', () => {
    const output = sanitizeSteelToolOutput({
      ruleCandidates: Array.from({ length: 101 }, (_, index) => ({ id: index + 1 })),
    });

    expect(output.ruleCandidates).toHaveLength(100);
    expect(JSON.stringify(output.ruleCandidates)).not.toContain('"id":101');
  });
});

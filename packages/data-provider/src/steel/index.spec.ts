describe('Steel public barrel exports', () => {
  it('does not export legacy workbook or file-analysis persistence contracts', async () => {
    const contracts = await import('./index');

    expect('steelWorkbookSchema' in contracts).toBe(false);
    expect('steelWorkbookPatchRequestSchema' in contracts).toBe(false);
    expect('requiredSteelWorkbookSheetIds' in contracts).toBe(false);
    expect('steelSelectedWorkbookRefSchema' in contracts).toBe(false);
    expect('steelFileAnalysisDataSchema' in contracts).toBe(false);
    expect('patchFileAnalysisDataToolInputSchema' in contracts).toBe(false);
    expect('steelFileAnalysisManualPatchRequestSchema' in contracts).toBe(false);
  });
});

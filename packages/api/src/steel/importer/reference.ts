export interface SteelReferenceImportOptions {
  referenceDir?: string;
}

export interface SteelReferenceImportPlan {
  factSources: string[];
  workbookOnlySources: string[];
  catalogFamilies: never[];
  priceCategories: never[];
  customerTiers: never[];
  customers: never[];
  priceItems: never[];
  cuttingPrices: never[];
  formulaVersions: never[];
  quoteDefaults: never[];
  summary: {
    catalogFamilies: 0;
    priceCategories: 0;
    customerTiers: 0;
    customers: 0;
    priceItems: 0;
    cuttingPrices: 0;
    formulaVersions: 0;
    quoteDefaults: 0;
  };
}

export const steelReferenceFileImportDisabledMessage =
  'Steel reference file imports are disabled because Steel quote data is database-backed. Use the reviewed database/Admin import flow instead.';

export class SteelReferenceFileImportDisabledError extends Error {
  constructor() {
    super(steelReferenceFileImportDisabledMessage);
    this.name = 'SteelReferenceFileImportDisabledError';
  }
}

export function buildSteelReferenceImportPlan(
  _options: SteelReferenceImportOptions,
): SteelReferenceImportPlan {
  throw new SteelReferenceFileImportDisabledError();
}

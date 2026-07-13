import { isPriceCategory, isPriceSubcategory } from './categories';
import { inferCatalogSubcategory } from './normalize/catalog';
import { inferProcessingSubcategory } from './normalize/processing';
import { inferStructuralSubcategory } from './normalize/structural';

import type { PriceSubcategory } from './categories';

export function inferSteelPriceSubcategory(
  categoryValue: string,
  productName: string,
): PriceSubcategory | undefined {
  if (!isPriceCategory(categoryValue)) {
    return undefined;
  }

  const inferred =
    inferProcessingSubcategory(categoryValue, productName) ??
    inferStructuralSubcategory(categoryValue, productName) ??
    inferCatalogSubcategory(categoryValue, productName);
  if (inferred === undefined) {
    return undefined;
  }
  if (!isPriceSubcategory(categoryValue, inferred)) {
    throw new Error(`Invalid inferred subcategory ${inferred} for category ${categoryValue}`);
  }

  return inferred;
}

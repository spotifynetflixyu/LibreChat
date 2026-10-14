import type { SteelReviewReadMethods, SteelReviewWriteMethods } from './steelReview';
import type { SteelQuotationInputMethods } from './steelQuotationInput';
import type { SteelReviewSourceMethods } from './steelSources';
import { createSteelReviewReadMethods, createSteelReviewWriteMethods } from './steelReview';
import { createSteelQuotationInputMethods } from './steelQuotationInput';
import { createSteelReviewSourceMethods } from './steelSources';

/** Steel methods exposed through the shared `db` method type. */
export type SteelMethods = SteelReviewReadMethods & SteelReviewSourceMethods & SteelQuotationInputMethods;

/** Registers Steel methods; upstream createMethods spreads this once. Write methods are kept off the shared type. */
export function createSteelMethods(
  mongoose: typeof import('mongoose'),
): SteelMethods & SteelReviewWriteMethods {
  return {
    ...createSteelReviewReadMethods(mongoose),
    ...createSteelReviewWriteMethods(mongoose),
    ...createSteelReviewSourceMethods(mongoose),
    ...createSteelQuotationInputMethods(mongoose),
  };
}

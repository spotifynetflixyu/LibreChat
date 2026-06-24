import { Schema } from 'mongoose';

import type { ISteelNamedState } from '~/types';

export function createSteelNamedStateSchema(): Schema<ISteelNamedState> {
  return new Schema<ISteelNamedState>(
    {
      name: {
        type: String,
        index: true,
      },
      status: {
        type: String,
        index: true,
      },
    },
    { timestamps: true },
  );
}

import { createSteelNamedStateSchema } from './state';

import type { Schema } from 'mongoose';
import type { ISteelNamedState } from '~/types';

const steelMemorySchema: Schema<ISteelNamedState> = createSteelNamedStateSchema();

export default steelMemorySchema;

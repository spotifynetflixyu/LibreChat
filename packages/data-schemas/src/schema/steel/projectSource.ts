import { createSteelNamedStateSchema } from './state';

import type { Schema } from 'mongoose';
import type { ISteelNamedState } from '~/types';

const steelProjectSourceSchema: Schema<ISteelNamedState> = createSteelNamedStateSchema();

export default steelProjectSourceSchema;

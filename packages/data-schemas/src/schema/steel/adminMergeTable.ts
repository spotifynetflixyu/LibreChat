import { createSteelNamedStateSchema } from './state';

import type { Schema } from 'mongoose';
import type { ISteelNamedState } from '~/types';

const steelAdminMergeTableSchema: Schema<ISteelNamedState> = createSteelNamedStateSchema();

export default steelAdminMergeTableSchema;

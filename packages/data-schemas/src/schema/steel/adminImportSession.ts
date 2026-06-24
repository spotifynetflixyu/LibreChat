import { createSteelNamedStateSchema } from './state';

import type { Schema } from 'mongoose';
import type { ISteelNamedState } from '~/types';

const steelAdminImportSessionSchema: Schema<ISteelNamedState> = createSteelNamedStateSchema();

export default steelAdminImportSessionSchema;

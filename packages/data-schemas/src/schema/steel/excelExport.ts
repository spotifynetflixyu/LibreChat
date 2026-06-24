import { createSteelNamedStateSchema } from './state';

import type { Schema } from 'mongoose';
import type { ISteelNamedState } from '~/types';

const steelExcelExportSchema: Schema<ISteelNamedState> = createSteelNamedStateSchema();

export default steelExcelExportSchema;

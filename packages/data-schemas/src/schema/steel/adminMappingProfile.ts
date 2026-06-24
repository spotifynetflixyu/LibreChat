import { createSteelNamedStateSchema } from './state';

import type { Schema } from 'mongoose';
import type { ISteelNamedState } from '~/types';

const steelAdminMappingProfileSchema: Schema<ISteelNamedState> = createSteelNamedStateSchema();

export default steelAdminMappingProfileSchema;

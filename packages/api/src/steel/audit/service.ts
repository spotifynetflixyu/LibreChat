import { createSteelAuditLogModel } from '@librechat/data-schemas';

import type { SteelAuditEvent, SteelAuditRecorder } from '../conversations/service';

type Mongoose = typeof import('mongoose');

export function createMongooseSteelAuditRecorder(mongoose: Mongoose): SteelAuditRecorder {
  const SteelAuditLog = createSteelAuditLogModel(mongoose);

  return {
    async record(event: SteelAuditEvent) {
      await SteelAuditLog.create(event);
    },
  };
}

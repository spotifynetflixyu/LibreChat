import { steelCustomerCommitSchema } from 'librechat-data-provider';
import type { SteelCustomerErrorCode } from 'librechat-data-provider';
import type { SteelCustomerMethods } from '@librechat/data-schemas';
import type { Request, Response } from 'express';

interface CustomerRequest extends Request {
  user?: { id?: string; tenantId?: string };
  tenantId?: string;
}

function sendFailure(res: Response, code: SteelCustomerErrorCode): void {
  const status = { CUSTOMER_NOT_FOUND: 404, CUSTOMER_INVALID_TABLE: 422,
    CUSTOMER_HISTORICAL: 409, CUSTOMER_CONFLICT: 409, CUSTOMER_BUSY: 409 }[code];
  res.status(status).json({ code });
}

export interface SteelCustomerRouteHandlers {
  commit(req: CustomerRequest, res: Response): Promise<void>;
}

export function createSteelCustomerRouteHandlers(methods: SteelCustomerMethods): SteelCustomerRouteHandlers {
  async function commit(req: CustomerRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ code: 'AUTH_REQUIRED' }); return; }
    const parsed = steelCustomerCommitSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.conversationId !== req.params.conversationId) {
      res.status(400).json({ code: 'INVALID_CUSTOMER_REQUEST' }); return;
    }
    const scope = { userId, tenantId: req.tenantId ?? req.user?.tenantId };
    try {
      const result = await methods.commitSteelCustomer({ ...parsed.data, ...scope });
      if (!result.ok) { sendFailure(res, result.code); return; }
      res.status(200).json(result.value);
    } catch {
      res.status(503).json({ code: 'CUSTOMER_REQUEST_FAILED' });
    }
  }
  return { commit };
}

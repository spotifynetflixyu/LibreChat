import { steelCustomerQuerySchema, steelCustomerCommitSchema } from 'librechat-data-provider';
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
  read(req: CustomerRequest, res: Response): Promise<void>;
  commit(req: CustomerRequest, res: Response): Promise<void>;
}

export function createSteelCustomerRouteHandlers(methods: SteelCustomerMethods): SteelCustomerRouteHandlers {
  const handle = (commit: boolean) => async (req: CustomerRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ code: 'AUTH_REQUIRED' }); return; }
    const conversationId = req.params.conversationId;
    const parsed = commit
      ? steelCustomerCommitSchema.safeParse(req.body)
      : steelCustomerQuerySchema.safeParse({ ...req.query, conversationId });
    if (!parsed.success || parsed.data.conversationId !== conversationId) {
      res.status(400).json({ code: 'INVALID_CUSTOMER_REQUEST' }); return;
    }
    const scope = { userId, tenantId: req.tenantId ?? req.user?.tenantId };
    try {
      if (commit) {
        const input = steelCustomerCommitSchema.parse(parsed.data);
        const result = await methods.commitSteelCustomer({ ...input, ...scope });
        if (!result.ok) { sendFailure(res, result.code); return; }
        res.status(200).json(result.value);
        return;
      }
      const result = await methods.readSteelCustomer({ ...parsed.data, ...scope });
      if (!result.ok) { sendFailure(res, result.code); return; }
      res.status(200).json(result.value);
    } catch {
      res.status(503).json({ code: 'CUSTOMER_REQUEST_FAILED' });
    }
  };
  return { read: handle(false), commit: handle(true) };
}

---
status: accepted
---

# Keep quotation execution independent and resume it before new conversation work

Quotation execution uses the OCR workflow as a reference for persisted progress and activity reporting, but owns a separate lifecycle, signal index, and artifacts. A completed AI response may request quotation; the backend starts it only after accepting a new signal and validating persisted customer data and the complete conversation OCR result, then resumes any unfinished quotation before running ordinary conversation AI again. This serializes quotation and later order changes so completed chunks and the final order share one fixed input, trading immediate handling of new requests for recoverable, consistent quotation results.

New messages remain pending until the active quotation completes or is explicitly cancelled, then are processed once in arrival order. Order changes produce a new complete `ocr_result` for user confirmation before a new quotation signal; a dedicated cancel button ends an unwanted or repeatedly failing run without deleting its debug artifacts. Recovery reuses validated complete chunk Markdown and reruns only unfinished chunks or unfinished final aggregation, accepting possible repeated work within an unfinished chunk in exchange for a simpler durable recovery boundary.

Each executed quotation child must call `search_price_candidates` and save its partial quotation as `system_order_chunk`, using the same table columns as the final `system_order`. After all chunk batches complete, the quotation main agent consolidates those saved results through its existing AI-owned output workflow, including its checks, supporting Markdown, and conditional `manual_review`; it has no price-search tool access. The backend generates `customer_quote` and the final completion summary. This changes how quotation work is executed while preserving the clarified division of output responsibilities between AI and backend.

The [design specification](../plans/2026-09-17-quotation-preflight.md) records the agreed behavior. The workflow is implemented locally in `packages/api/src/steel/quotation/` with chat and activity UI integration; the specification records validation and deployment limits.

# Use Provider-Prepared Context For Steel Quote Turns

## Status

Accepted.

Steel quote turns use provider-prepared context instead of asking AI to assemble its own rule and memory context through rule/memory lookup tools. Before `sendSteelOAuthChat`, backend loads reviewed Agent rules, global Steel rules, conditional OCR/file rules, and full active output sheet state for `system_order`, `customer_data`, `manual_review`, and `customer_quote`; AI-visible tools are limited to live customer search, price search, and OCR. This is deliberate because the quote runtime needs fewer orchestration loops, clearer source priority, synchronized output sheets, and predictable edit/rerun rollback while still letting AI choose among reviewed price/customer/OCR evidence.

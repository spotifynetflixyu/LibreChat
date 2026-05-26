# Use openai-oauth Responses as the Steel Primary AI Driver

Steel v8.3 uses `openai_oauth_responses` as the primary AI driver, implemented through direct `openai-oauth-provider` after AI SDK 6 package versions are unified through package-manager overrides/resolutions and LibreChat packaging is verified.

The `openai-oauth` localhost `/v1` proxy is retained only as a manual diagnostic smoke probe. It is not a runtime route, not selected by environment, and not a hosted multi-user service.

`openai_api` remains a capability-gated secondary driver. This is deliberate because the project needs subscription-backed development while avoiding an untested official API safety net: every file, vision, XLSX, hosted-tool, tool-call, and structured-output fallback must have live smoke evidence before routing to the secondary driver.

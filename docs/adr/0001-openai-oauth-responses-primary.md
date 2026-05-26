# Use openai-oauth Responses as the Steel Primary AI Driver

Steel v8.3 uses `openai_oauth_responses` through the openai-oauth localhost proxy and `/v1/responses` as the primary local/dev AI driver, with `openai_api` only as a capability-gated secondary driver. This is deliberate because the project needs subscription-backed development while avoiding an untested official API safety net: every file, vision, XLSX, hosted-tool, tool-call, and structured-output fallback must have live smoke evidence before routing to the secondary driver.

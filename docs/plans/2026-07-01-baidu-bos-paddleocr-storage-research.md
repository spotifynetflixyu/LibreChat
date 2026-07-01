# Baidu BOS PaddleOCR Storage Research

Date: 2026-07-01

## Goal

Research whether Baidu BOS should replace or augment AWS S3 for LibreChat
PaddleOCR `fileUrl` handoff, because AWS S3 and PaddleOCR AI Studio have shown
network instability on real production inputs.

This document is research only. It does not change runtime behavior.

## Current LibreChat Path

- Production uses `fileStrategy: "s3"` for new uploads, with `S3_KEY_PREFIX=prod`
  and long private presigned URLs.
- `api/server/services/MCP.js` resolves `paddleocr_vl.input_data` from the
  current request attachments. If the matched file has `source: s3`, it calls
  the storage strategy `getDownloadURL()` and passes that signed URL to
  PaddleOCR. Other sources are streamed server-side and converted to a
  `data:<mime>;base64,...` input.
- S3 signing is implemented through `@aws-sdk/client-s3` and
  `@aws-sdk/s3-request-presigner` in `packages/api/src/storage/s3/crud.ts`.
- Current production evidence says AWS S3 Hong Kong `ap-east-1` works for small
  files, but larger files can still fail before AI Studio returns a job id.

Relevant local files:

- `api/server/services/MCP.js`
- `api/server/services/Files/strategies.js`
- `packages/api/src/cdn/s3.ts`
- `packages/api/src/storage/s3/crud.ts`
- `packages/api/src/storage/s3/s3Config.ts`
- `deploy/host/paddleocr-smoke.sh`
- `docs/deployment/digitalocean-droplet-prod-runbook.md`
- `docs/deployment/digitalocean-droplet-prod-runbook.zh-TW.md`

## Baidu BOS Findings

Baidu BOS has an AWS S3 compatible surface:

- Official docs say applications based on AWS S3 tools can access BOS by
  setting the access endpoint to the BOS AWS S3 service domain.
- The AWS SDK for JavaScript example uses `S3Client` plus
  `@aws-sdk/s3-request-presigner` `getSignedUrl()` for download links, matching
  LibreChat's current technical stack.
- BOS supports AWS Signature Version 4. The credential scope uses BOS region
  names such as `bj`, `bd`, `su`, `gz`, `fwh`, and `hkg`.
- Official S3 Browser docs require S3 Compatible Storage, Signature V4, and
  virtual-hosted-style addressing for BOS.
- Native BOS docs also support private pre-signed object URLs and region
  endpoint selection.

Useful official references:

- https://cloud.baidu.com/doc/BOS/s/ojwvyq973
- https://cloud.baidu.com/doc/BOS/s/Hjwvyq84s
- https://cloud.baidu.com/doc/BOS/s/Cl5jgit2o
- https://cloud.baidu.com/doc/BOS/s/Tjwvyrw7a
- https://cloud.baidu.com/doc/BOS/s/Im885d7q2
- https://intl.cloud.baidu.com/en/doc/BOS/s/pll4udmqd-intl-en

Important uncertainty: BOS docs differ slightly by page. Some native presigned
URL docs mention Beijing, Guangzhou, and Suzhou, while SDK/signature docs also
list Hong Kong and other regions. The actual selectable bucket regions must be
confirmed in the Baidu console before choosing the test region.

## Hypotheses To Test

1. If AI Studio download path to AWS S3 is the bottleneck, then a BOS signed URL
   in a Baidu-accessible region should return PaddleOCR job ids faster and with
   fewer `文件 URL 访问超时` / `HTTP 408` failures than AWS S3 for the same file.
2. If file size/page complexity is the real bottleneck, then BOS will improve
   small-file success but the large drawing PDF will still fail; splitting or
   reducing files will be required.
3. If DigitalOcean SGP1 outbound upload is the bottleneck, then `fileUrl`
   handoff to BOS should help compared with `file_path` multipart upload from
   the Droplet, but only after the file is already in BOS.
4. If cross-border routing is unstable, then mainland BOS may help AI Studio
   download but may worsen uploads from the Singapore Droplet or Taiwan users.
   Hong Kong BOS may be a useful control region if available.

## Options

### Option A: Config-only full storage switch to BOS

Use the existing S3 strategy and change production env values to Baidu:

```bash
AWS_REGION=bj
AWS_BUCKET_NAME=<bos-bucket>
AWS_ACCESS_KEY_ID=<baidu-access-key-id>
AWS_SECRET_ACCESS_KEY=<baidu-secret-access-key>
AWS_ENDPOINT_URL=https://s3.bj.bcebos.com
S3_URL_EXPIRY_SECONDS=43200
S3_KEY_PREFIX=prod
# AWS_FORCE_PATH_STYLE should stay unset/false for BOS virtual-hosted style.
```

Keep `/data/librechat.yaml`:

```yaml
fileStrategy: "s3"
```

Pros:

- Minimal code change, possibly config-only.
- Reuses existing upload, signed URL, ownership, delete, and smoke paths.

Risks:

- Existing Mongo file records only say `source: s3` plus `storageKey`; they do
  not identify AWS vs BOS. If production env points to BOS before existing AWS
  objects are copied to the same keys, old files will be looked up in BOS and
  may break.
- This changes all LibreChat uploads, not only PaddleOCR.
- It does not prove BOS fixes large-file AI Studio timeouts.

Use only after live BOS smoke succeeds and after either:

- copying existing production S3 objects to BOS with identical keys, or
- accepting that old S3-backed files are no longer available, or
- adding a real multi-provider storage record before the switch.

### Option B: OCR-only BOS mirror, recommended if BOS smoke succeeds

Keep canonical LibreChat storage on AWS S3. For PaddleOCR only, when the matched
attachment is S3-backed:

1. Resolve the permission-checked current attachment.
2. Stream the object from canonical storage.
3. Upload a temporary copy to BOS under an OCR prefix such as
   `prod-ocr/<requestId>/<fileId>/<filename>`.
4. Generate a private BOS presigned GET URL.
5. Pass the BOS URL to `paddleocr_vl.input_data`.
6. Delete eagerly after the OCR call where possible, and also enforce a BOS
   lifecycle rule for the OCR prefix.
7. Fall back to current AWS S3 signed URL if BOS upload/signing fails and the
   operator wants fallback behavior.

Pros:

- Does not risk old file records.
- Narrows the change to PaddleOCR reliability.
- Allows A/B comparison and fallback.
- Keeps BOS credentials separate from canonical S3 credentials.

Risks:

- Requires code and tests.
- Adds extra upload and storage cost.
- Large files may still fail if AI Studio processing or download limits are the
  bottleneck.

Likely code seams:

- Add a typed helper in `packages/api` for BOS-compatible temporary OCR object
  upload/sign/delete.
- Keep legacy `/api` edits thin, probably inside `api/server/services/MCP.js`
  only to call the helper before returning `input_data`.
- Add focused tests around `prepareMCPToolArguments()` / resolver behavior:
  BOS enabled, BOS disabled, BOS failure fallback, no signed URL logging, and
  non-S3 sources staying on the data URL path.

### Option C: First-class `bos` file strategy

Add a new `FileSources.bos` and storage strategy.

Pros:

- Clean domain model if BOS becomes a permanent general storage provider.

Risks:

- Broad shared-type, config, frontend, and backend blast radius.
- Existing records and migration still need a provider-aware plan.
- Too much work before proving BOS fixes the PaddleOCR instability.

Not recommended as the first step.

### Option D: API file proxy for PaddleOCR

Expose a temporary LibreChat URL and let AI Studio download from the API.

Not recommended. Prior evidence already shows Droplet-hosted file URL downloads
can fail for larger files, and this keeps the DigitalOcean network path in the
middle.

## Recommended Path

1. Do not switch production `fileStrategy` yet.
2. Create a private BOS test bucket with a DNS-safe bucket name, no dots, in one
   or more candidate regions. Start with `bj` or `gz`; test `hkg` too if the
   console allows it.
3. From the production API container, run a one-off BOS put/get/delete and
   presigned URL smoke using the same AWS SDK v3 stack.
4. Validate the BOS signed URL with a signed `GET`, ideally `Range: bytes=0-0`.
5. Run PaddleOCR live smoke against BOS signed URLs for the same known fixtures
   used in current AWS evidence: small PNG, small PDF, and the larger drawing
   PDF or split pages.
6. If BOS materially improves job creation and completion, implement Option B
   OCR-only BOS mirror.
7. Only consider Option A after Option B proves stable and after production
   object migration is explicitly planned.

## Verification Design

A valid BOS experiment must collect:

- BOS region and endpoint.
- Object size, MIME type, and file name.
- API-container signed `GET` result, including `206 Partial Content` or the
  actual status if BOS responds differently to range GET.
- PaddleOCR submit latency until job id.
- PaddleOCR completion latency.
- Failure code/body preview, redacted.
- Whether the URL or credentials were redacted from logs.
- Comparison against the current AWS S3 Hong Kong path for the same object.

Minimum pass criteria before code work:

- At least three consecutive successful small-file PaddleOCR runs through BOS.
- No signed URL leakage in smoke logs.
- At least one medium PDF run comparable to or better than current AWS S3 Hong
  Kong behavior.
- Clear evidence whether large-file failure is storage-route related or
  file-size related.

## Open Questions

- Which BOS regions are available in the account linked from the console?
- Is AI Studio PaddleOCR deployed closer to mainland BOS regions or Hong Kong?
- Does BOS S3-compatible presigned URL accept the exact response header query
  parameters LibreChat adds for `customFilename` and `contentType`?
- Should BOS be only a temporary OCR mirror, or should the product eventually
  store all uploads there?
- What retention period is acceptable for OCR mirror objects?

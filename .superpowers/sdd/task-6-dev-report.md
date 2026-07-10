# Task 6 Report: dev Steel pricing v4.2 rollout

Date: 2026-07-11
Target: repository `.env` `STEEL_POSTGRES_URL` only

## Safety boundary

- The repository `.env` contained a PostgreSQL Supabase connection and was used
  as the plan-defined dev target. The URL and credentials were never printed.
- `.env.prod` was not read, sourced, compared, connected to, or modified.
- No Docker or local PostgreSQL path was used.
- **production not accessed or modified**

## Preflight

The importer dry-run read only `docs/products_db_v4.2.xlsx` sheet
`products_db_ready` and reconciled:

- 6,761 import rows and 0 duplicate ERP item codes;
- 6,761 active and 6,761 reviewed rows;
- 4,880 `confirmed`, 230 `ratio_only`, and 1,651 `no_price` rows.

The rule dry-run emitted 9 current rules: agent, output, OCR, and 6 category
rules. Every category-rule source used `docs/rules/類別規則/...`.

The read-only dev catalog preflight found:

- PostgreSQL 17.6 and `pg_trgm` 1.6;
- 6,464 price rows in the old 31-column table;
- 6,367 non-null ERP values and 6,363 distinct ERP values;
- 6,147 active, 4,062 reviewed, 4,115 confirmed, 0 ratio-only, and 2,349
  unknown rows.

Migration history was missing `20260623115453`, while both columns and all
three indexes from `20260623115453_steel_prices_subcategory.sql` already
existed. The version was therefore repaired as applied before the v4.2 rollout.

## Migration and atomic replacement

The dev rollout used this exact order:

1. Repair `20260623115453` as applied after structural readback.
2. Apply `20260710144502_steel_prices_v4_2_expand.sql` in one transaction and
   record `20260710144502` as applied.
3. Verify all 27 added columns, the 58-column expanded table, and all 6,464 old
   rows remained readable.
4. Run `node packages/api/scripts/import-steel-price-v4.cjs --apply`. Its
   locked replacement transaction committed only after reading back 6,761
   total/distinct ERP/active/reviewed/v4.2 rows and state totals
   4,880/230/1,651.
5. Apply `20260710144509_steel_prices_v4_2_finalize.sql` in one transaction and
   record `20260710144509` as applied.

Final migration history contains all three required versions:

- `20260623115453`
- `20260710144502`
- `20260710144509`

## Final dev price verification

Fresh catalog readback matched the v4.2 contract:

- 6,761 rows, non-null ERP values, distinct ERP values, active rows, reviewed
  rows, and `product_price_v4_2` rows;
- state totals 4,880 confirmed / 230 ratio-only / 1,651 no-price;
- exact 51-column final table, with all seven replaced legacy fields absent;
- ERP `NOT NULL` and unique;
- 12 required category/value/cost/source/state/non-negative constraints present
  and validated;
- category lookup, reviewed/active, product/subcategory/thickness trigram, and
  `spec_key` trigram indexes present;
- `spec_key` has no unique index and remains keyword text;
- zero rows containing a zero price or ratio placeholder;
- zero invalid no-price rows and zero ratio-only rows carrying direct prices;
- ERP `KA02I` is `加工/其他 -> 扁鐵`, and `加工/其他 -> 扁` has 0 rows.

## Dev rule sync

`sync-steel-rules.cjs --dry-run` and `--apply` both completed. Readback found all
9 expected slugs active and reviewed with these current first-source hashes:

| Slug | SHA-256 |
| --- | --- |
| `steel-default-agent-instruction` | `443885d7f1c8de06fdd2e959fb82f69c7e8d1bc29cf253dae9ecf7a2062ff5d0` |
| `steel-workbook-output-policy` | `f087dc783a3ba00cb3339cddd1824c4791b7f06cf47bfc0a2a58c8812d23fe3a` |
| `steel-drawing-ocr-policy` | `e4f55a326a55963629ed6d40e1b6b4e7e17b7f9ab46beca425fbf21bc3d67a7b` |
| `steel_category_price_lookup_guide` | `f0a99cf77d98d8f7d0dd0002cf0ad7876292a15d53f73984e73fea9aad752c52` |
| `steel_quote_rules_c_type` | `e9b7ade35309a575077552b591830603a34fe423173b6d45c90ef678b51db140` |
| `steel_quote_rules_h_beam` | `c73d0cbc08bef303019919a361920890751a672d22c4c5c228b45a23e9e23fb9` |
| `steel_quote_rules_hole` | `698a2768701e782fddc8aee5420399d9b12439765b17bcfd4330ec2447ac2d9e` |
| `steel_quote_rules_long_material_cutting` | `8c6cc3a7afa24d8c0af0d77103479946aaf9edc9e14caea75bde76297c9572c9` |
| `steel_quote_rules_plate` | `3423a8e555e229739717bbf0426ed2116bfe8f9f4219ac87a507d3e384309aa8` |

Exactly 6 active rows use `factType=category_rule`; all use current
`docs/rules/類別規則/...` source paths. No active legacy `鋼材規則` source-path
row remains. The output-rule prompt readback includes `system_order.度`, the
`捲門/伸縮門` gate, formulas DA/DB/DC, and the blank-for-other-categories rule.

## Grouped live lookup smoke

One real `search_price_candidates` tool call used 4 explicit query IDs and one
repository SQL roundtrip. All groups returned `status=ok`:

- `direct-limit-101`: ERP `A05C08`; input limit 101 normalized to 100; pricing
  option order is `tier_price`, then `price_ratio`; the direct option exposes
  A-F keys and is quote-eligible. The dev workbook has no confirmed row with all
  six direct tiers non-null, so the smoke correctly permits null tier members.
- `ratio-kg`: ERP `B2NT900040`, unit `Kg`; ratio option is quote-eligible.
- `ratio-other-unit`: ERP `AKG13100`, unit `尺`; no quoteable pricing option and
  the ratio is skipped as `category_rule_pending`.
- `thickness-2`: ERP `AJS23`; `thicknessMm:["2"]` returned
  `sourceThickness="2"`.

No candidate exposed a raw top-level ratio key.

## Repository verification

- Focused parser/importer/category/schema/repository/executor/provider/memory/
  rule-sync/degree run: 12 suites, 148 tests passed.
- Mongo-backed system-order persistence smoke: 1 selected test passed.
- `cd packages/api && npm run build`: passed, including declaration output.
- Focused ESLint: no issues.
- `node --check` passed for both v4 importer and rule-sync scripts.
- `git diff --check`: passed.
- Prettier was not run.

The first package build exposed missing isolated-declaration annotations in the
new category registry. The runtime values and order were preserved while exact
tuple/registry types were added in `601f33ac7`. Two rule-sync array formatting
findings were corrected manually, without running Prettier, in `a1d874b3d`.

## Handoff

Dev prices and rules are verified. Production remains intentionally blocked
until the user explicitly approves Task 7. **production not accessed or
modified**

# Phase 3: Material Rule Architecture

Goal: make material-specific company rules queryable, testable, and task-scoped.

## Rule Table Shape

Rules should be stored as data, not hard-coded prompt blocks:

```text
steel.material_rules
- code
- name
- rule_type
- active
- priority
- source_ref
- rule_body JSONB
```

`rule_body` should be validated by code per `rule_type`.

## MVP Rule Types

### C-Type Roll Forming

Applies to C-type steel, galvanized C-type steel, and related aliases.

Behavior:

- Use finished length for material quantity.
- Do not run long-material stock allocation.
- Do not calculate stock pieces, remainder length, or remainder weight.
- Do not add general cutting fee by default.
- Do not add hole fee by default.
- Add cutting/hole fees only when user explicitly says separately charged or when product price contains an explicit C-type cutting/hole item.
- In system order output, default to material rows only; processing rows appear only when separately charged.

### H-Type Non-Standard Length Surcharge

Applies to H-type steel.

Behavior:

- Regular lengths: 6M, 9M, 10M, 12M.
- Non-standard lengths: 7M, 8M, 11M, 13M, 14M, 15M.
- Non-standard material unit price = regular material unit price + 0.3 per kg.
- Cutting price remains separately resolved from cutting-price data.

### Long-Material Allocation

Applies to non-C long materials such as angle, flat bar, channel, I-beam, round bar, square bar, pipe, and square tube.

Behavior:

- Unless user explicitly permits cut-clear, quote by sellable stock length rather than finished net length.
- Return stock length, stock pieces, pieces per stock, produced finished pieces, remainder length/weight, confidence, and reason.

### Cutting Rule

Applies when cutting is required or requested.

Behavior:

- Product price explicit cutting item wins.
- Otherwise use cutting-price data.
- H-type cutting and black-iron cutting have different source sections.
- Repair head/tail and angled cuts produce additional cutting-count or adjustment behavior when confirmed.

## Rule Disclosure To AI

The prompt bundle should not include all material rules. It should include:

- normalized quote item facts
- matching material rules only
- source refs and confidence
- a short explanation of blocked default paths, such as C-type blocking long-material allocation

## Exit Criteria

- AI can request relevant rules through `lookup_material_rules`.
- Irrelevant rules are not injected into unrelated quote items.
- Material rules are covered by unit tests and manual scenario tests.

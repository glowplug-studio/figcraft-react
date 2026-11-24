# Roadmap row 15, item 2: prototype expressions

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `abe7345`. **This bounded item passes. The rest of row 15, the roadmap and the full port remain unfinished.**

## Implemented boundary

Prototype expressions are what a set variable action writes and what a conditional block tests. The port stored and carried their trees but could not read the text people type, check it, evaluate it or show it. [`prototype-expressions.ts`](../../src/engine/prototype-expressions.ts) restates native's parser (variables by name, the longest name first, `{name}`, `name[Mode]`, `mode(Collection)`, literals, operators and their precedence), its type checks, its evaluator (in the modes where an expression runs) and its display, with native's messages. [`prototype-commands.ts`](../../src/engine/prototype-commands.ts) now reads expression text and names in `proto.interaction.add` and `set`, storing ids, and answers `proto.evaluate`.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-prototype-expressions.json](../../tests/fixtures/native-prototype-expressions.json) | 89 steps: setup, 63 evaluations, 14 expression-carrying interaction commands and the stored interactions | Every result, type, display text, error and stored interaction matches. Failed before |

Provenance: [prototype expressions](../../tests/fixtures/native-prototype-expressions.provenance.md).

## Recorded differences

- **No browser case.** The interaction editor (item 8) types expressions; its browser case is in the deferred queue with item 1's.

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/proto_expr_parse.rs` (`Expr::parse`, `type_of`, `check_condition`, `check_value`) | `prototype-expressions.ts` `parseExpression`, `expressionType`, `checkCondition`, `checkValue` |
| `crates/doc/src/proto_expr.rs` (`Expr::eval`, `display`) | `prototype-expressions.ts` `evaluateExpression`, `displayExpression` |
| `crates/engine/src/cmd/proto_actions.rs::{with_expressions, evaluate}`, `cmd/proto.rs::canonical_expr` | `prototype-commands.ts` `canonicalExpression`, `proto.evaluate` |

[Property matrix](26-11-24-prototype-expressions-parity.html) · [Plan](../planning/26-11-24-prototype-expressions.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-expressions.test.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `abe7345`, native reference `bad07e44` |
| Failing fixtures first | The parity case failed before |
| Full pure suite | 5,592 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 430 cumulative Chromium cases passed in one 17.5-minute run at `abe7345` with zero skips, retries, flakes or suite errors; this item adds no browser case. No baseline changed |
| Real local provider integrations | 32 passed in 14.17 seconds, run once after the browser gates of items 2 to 4 (the publication rate window from item 1's second run had to clear) |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,054 nodes/38,625 edges at `abe7345`; native 28,939/92,127 at `bad07e44`; combined 37,993/129,549. `parseExpression`, `evaluateExpression`, `displayExpression`, `canonicalExpression` and `expressionType` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-expressions.test.ts
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 items 3 to 10.

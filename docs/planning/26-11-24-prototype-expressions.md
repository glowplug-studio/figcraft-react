# Roadmap row 15, item 2: prototype expressions

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `abe7345`: [report](../reports/26-11-24-prototype-expressions.md), [matrix](../reports/26-11-24-prototype-expressions-parity.html), [provenance](../../tests/fixtures/native-prototype-expressions.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `62dbbe4` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/engine/prototype-expressions.ts` (new: `parseExpression`, `expressionType`, `checkCondition`, `checkValue`, `evaluateExpression`, `displayExpression`, native's variable, collection and mode lookups); `src/engine/prototype-commands.ts` (`proto.evaluate`, `canonicalExpression`, expression text and names in `proto.interaction.add` and `set`); `src/engine/prototype-data.ts` (`readPrototype.expression`); test `tests/parity/prototype-expressions.test.ts`; fixture `tests/fixtures/native-prototype-expressions.json` with provenance.
- Next action: none; the item is recorded.
- Blockers: none.

## Native contract

- **`doc/src/proto_expr_parse.rs::Expr::parse`**: variables by name or id, the longest name first, a name not running on into a longer word; `{name}` always a variable; `name[Mode]` its value in a mode of its collection; `mode(Collection)` the mode a collection is in. Literals: numbers (with exponents), `"text"` or `'text'` with escapes, `true` and `false` (any case), `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`. Operators loosest first: `or`/`||`, `and`/`&&`, `not`/`!`, one comparison (`==` or `=`, `!=`, `<`, `<=`, `>`, `>=`; a chain only of `==` or of `!=`), `+`/`-`, `*`/`/`, unary `-`. A run of one operator is one n-ary operation; a change of operator nests. Messages for people with where it went wrong; 4,000 characters at most; nesting bounded.
- **`type_of`, `check_condition`, `check_value`**: the type an expression gives or why not; a condition gives true or false; a text variable takes numbers and booleans.
- **`doc/src/proto_expr.rs::Expr::eval`**: variables resolved in the modes where it runs; `+` joins text (numbers trimmed to hundredths, 10,000 characters at most) or adds numbers; division by zero and non-finite results give nothing; numbers compare within a relative 1e-9; colours compare by their bytes; texts compare by code point. **`display`**: text that reads back, variables bare when that reads back as them, else `{name}` or `{id}`; numbers as Rust prints them.
- **`cmd/proto_actions.rs::with_expressions`**: before `proto.interaction.add` and `set` read their actions, a set variable's variable and a set variable mode's collection and mode given by name become ids; `expr` and `condition` JSON have their names stored as ids; `expression` text is parsed and checked, becoming a set variable's `expr` (with `value` null when absent) or a block's `condition`.
- **`proto.evaluate`**: `{expression | expr, id?}` → `{value, type, text}` in the layer's modes (or the defaults), changing nothing.

## The port

`prototype-expressions.ts` restates the parser, type checks, evaluator and display over the port's existing expression tree and variable model (`resolveVariable` and `layerModes` resolve values and modes). `prototype-commands.ts` runs `with_expressions` on the two commands' parameters and adds `proto.evaluate`. Characters are Unicode scalars as in native; Rust's float display, `Color::from_hex` and `trim_num` are matched.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc/src/proto_expr_parse.rs` (`Expr::parse`, `type_of`, `check_condition`, `check_value`) | `prototype-expressions.ts` `parseExpression`, `expressionType`, `checkCondition`, `checkValue` | Native observations |
| `doc/src/proto_expr.rs` (`Expr::eval`, `display`) | `prototype-expressions.ts` `evaluateExpression`, `displayExpression` | Native observations |
| `engine/src/cmd/proto_actions.rs::{with_expressions, evaluate}`, `cmd/proto.rs::canonical_expr` | `prototype-commands.ts` | Native observations |

## Acceptance

- 89 native steps match: 63 evaluations (results, types, display text and every error message), 14 expression-carrying commands and the stored interactions. The test failed before.
- No browser case: the interaction editor (item 8) takes it, entered in the deferred queue with item 1's.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.

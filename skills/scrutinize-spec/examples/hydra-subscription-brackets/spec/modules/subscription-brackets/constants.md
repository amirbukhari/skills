# Constants — `subscription-brackets`

Every load-bearing literal the rules reference, enumerated. No unpopulated values.

| Constant | Value | Used by | Meaning |
|---|---|---|---|
| `MISSING_MAXVALUE_DEFAULT` | `"0"` | S6 | Fallback string when `maxValue` is `null`/absent before `parseInt` (`curr.maxValue ?? "0"`, `array[index-1]?.maxValue ?? "0"`). |
| `PARSEINT_RADIX` | `10` | S6 | Base for `parseInt` when coercing `maxValue` to an integer for ranges. |
| `COERCION_EMPTY_STRING` | `""` | S1 | String used for `null`/`undefined` in `floatVal` (`parseFloat(String(x ?? ""))`), yielding `NaN`. |
| `RANGE_OPEN_SUFFIX` | `"+"` | S6.2 | Suffix for the final open-ended bracket (`null` last `maxValue`): `` `${prev+1}+` ``. |
| `RANGE_SEPARATOR` | `" - "` | S6.3–S6.4 | Separator between range bounds: `` `${lo} - ${hi}` ``. |
| `SORT_GREATER` | `1` | S3 | Comparer result placing `a` after `b` (also the `NaN`-A result). |
| `SORT_LESSER` | `-1` | S3 | Comparer result placing `a` before `b` (also the equal-values and `NaN`-B result). |
| `ASSERT_ERROR_MESSAGE` | `"Invalid IVariableBasePrice array. Expected an array containing only valid IVariableBasePrice objects."` | S5 | Exact message thrown on a shape violation. |
| `NULL_NOT_LAST_ERROR_MESSAGE` | `"Null max value must be the last item in the array."` | S6.1 | Exact message thrown when a `null` `maxValue` is not the last element. |

The generated code need not name these constants — it must reproduce the literal
values and the exact error strings.

# Constants — `cart`

```json
{
  "basisPointsDivisor": 10000
}
```

- `basisPointsDivisor` — the divisor that turns a basis-points rate into a
  fraction (1 basis point = 1/10000). Referenced by `tax` instead of a bare
  `10000` literal, so the meaning of the magic number lives in exactly one place.

# Bundled restaurant UI fonts

Downloaded unchanged on November 6, 2026, from Google Fonts' authoritative `fonts.gstatic.com` delivery. These are Latin subsets for the English interface. No conversion, local subsetting, or generated replacement files were used. The three WOFF2 assets total **93,008 bytes**.

| Asset | CSS family | Style / weight | Bytes |
| --- | --- | --- | ---: |
| `barlow-condensed-latin-600.woff2` | `Barlow Condensed` | normal / 600 | 22,308 |
| `barlow-condensed-latin-700.woff2` | `Barlow Condensed` | normal / 700 | 22,444 |
| `inter-latin-variable.woff2` | `Inter` | normal / 400–600 | 48,256 |

Inter's Google Fonts response uses the same variable WOFF2 binary for weights 400 and 600. It can be declared once with `font-weight: 400 600`. Barlow Condensed uses two separate static faces. From the restaurant stylesheet, use local relative URLs beginning `./fonts/`; runtime access to Google Fonts is unnecessary.

## Sources

- [Google Fonts CSS request for Barlow Condensed 600/700 and Inter 400/600](https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;600&display=swap)
- [Google Fonts variable Inter 400–600 CSS](https://fonts.googleapis.com/css2?family=Inter:wght@400..600&display=swap)
- Barlow Condensed 600 binary: <https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B4873z3bWuQ.woff2>
- Barlow Condensed 700 binary: <https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B46r2z3bWuQ.woff2>
- Inter variable binary: <https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2>

## Licenses

Both families are distributed under the **SIL Open Font License 1.1**. Keep the included copyright and license files with redistributed fonts:

- `OFL-BarlowCondensed.txt`: Copyright 2017 The Barlow Project Authors. [Official license source](https://github.com/google/fonts/blob/main/ofl/barlowcondensed/OFL.txt).
- `OFL-Inter.txt`: Copyright 2020 The Inter Project Authors. [Official license source](https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt).

## Integrity

All three binaries were checked for the WOFF2 signature `wOF2`. SHA-256:

```text
215a93c696f442034a46fbb382958f753fda60e30490683aeea6b235fcbb2b66  barlow-condensed-latin-600.woff2
3787a5a419171630e6890cfa47c4da067474d005cd0ff8dc11ec090fdc3ee2b8  barlow-condensed-latin-700.woff2
3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62  inter-latin-variable.woff2
```

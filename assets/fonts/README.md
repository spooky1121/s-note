# Included fonts

Manrope and Noto Sans KR are distributed under the SIL Open Font License 1.1; the original license files are included here.

Sources: [Manrope](https://github.com/google/fonts/tree/main/ofl/manrope), [Noto Sans KR](https://github.com/google/fonts/tree/main/ofl/notosanskr).

The Manrope and Noto Sans KR variable font files are locally hosted WOFF2 subsets (Latin, Hangul syllables/jamo and common punctuation), retaining their original family names. No external font requests are made.

## Pretendard Variable

S-NOTE's current UI and document text use the unmodified official **Pretendard Variable v1.3.9** font. It is self-hosted; existing Manrope/Noto files are retained for historical and compatibility consumers.

- Upstream: https://github.com/orioncactus/pretendard/tree/v1.3.9
- Original asset: `packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2`
- Download: https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2
- Original license: https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/LICENSE
- Local license: `Pretendard-OFL.txt` (SIL Open Font License 1.1)
- Asset bytes: `2057688`
- SHA256: `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`

The font file remains unmodified. Service/company logo artwork, signatures, uploaded documents and the generated legal seal artwork retain their original lettering.

The CSS aliases use the same original file with compatible line metrics: the original Manrope-covered 210 Latin/punctuation characters use `106.6% / 30% / 0%` ascent/descent/line-gap, and Korean/fallback text uses `116% / 28.8% / 0%`. This retains the former Latin-first mixed stack for `line-height: normal`; the mobile workbook retains its former Korean-first metrics. The unqualified `Pretendard Variable` face remains available for the startup readiness check and canvas width measurement. All faces share one versioned asset URL.

These descriptors do not modify the font file, glyph outlines, CSS font sizes, weights or declared line heights. Browser comparisons restored the original empty-sales content and mobile operator navigation dimensions without tracking changes. A few narrow static explanation blocks reserve only their former number of lines; the receipt reservation is screen-only, and the workbook's dynamic bank note reserves space only in its existing empty-data state.

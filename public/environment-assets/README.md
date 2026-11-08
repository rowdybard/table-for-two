# Restaurant environment assets

Curated on November 6, 2026. All image files are unchanged downloads from the authoritative deliveries listed in `manifest.json`. No generated replacements, repainted maps, large model packs, or character assets are included.

The nine material maps total **5,620,417 bytes**. The window photograph adds **296,048 bytes**, for **5,916,465 bytes (5.64 MiB)** of image payload.

## Materials

Each material directory contains `albedo.jpg`, `roughness.jpg`, and `normal-gl.jpg` at 1K resolution. The files were renamed for consistent loading; their bytes match the source's published MD5 checksums. SHA-256 checksums and exact download URLs are recorded in `manifest.json` and `SHA256SUMS.txt`.

Browser decoding verified the wood and plaster maps as 1024 × 1024. Poly Haven's nominal 1K Terlenka maps are 1024 × 1026; those two extra source rows are retained unchanged. The photograph decodes at 1280 × 960. All ten files load from the local public-asset URLs.

| Directory / use | Source and creator | Physical reference | License |
| --- | --- | --- | --- |
| `black_walnut_veneer_01` / furniture and wood trim | [Black Walnut Veneer 01](https://polyhaven.com/a/black_walnut_veneer_01), Jenelle van Heerden | 1 m wide | CC0 1.0 |
| `white_plaster_02` / clean plaster walls | [White Plaster 02](https://polyhaven.com/a/white_plaster_02), Rob Tuytel | 1 m wide | CC0 1.0 |
| `terlenka` / neutral cream woven cloth | [Terlenka](https://polyhaven.com/a/terlenka), colormass (photography), Rico Cilliers (processing) | 0.3 m tall | CC0 1.0 |

Terlenka is woven polyester, not linen. It supplies a neutral fine-weave cloth surface without introducing the blue or plaid colors of the other reviewed fabric candidates.

Poly Haven identifies each linked asset as CC0. Its [official asset license](https://polyhaven.com/license) permits commercial use and redistribution. This bundle includes the official [CC0 1.0 legal code](https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt) as `CC0-1.0.txt`. Credits are retained for provenance even though attribution is not a CC0 condition.

## Window photograph

- File: `seoul-night-1280.jpg`, 1280 × 960, sRGB JPEG.
- Work: **Seoul by night**, photographed August 22, 2007, by **Syced**.
- [Authoritative description and CC0 declaration](https://commons.wikimedia.org/wiki/File:Seoul_by_night.jpg).
- [Permanent description-page revision](https://commons.wikimedia.org/w/index.php?title=File:Seoul_by_night.jpg&oldid=1180353736).
- [Original photograph](https://upload.wikimedia.org/wikipedia/commons/f/f1/Seoul_by_night.jpg).
- [Exact 1280px Wikimedia thumbnail delivery](https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f1/Seoul_by_night.jpg/1280px-Seoul_by_night.jpg).
- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/), declared by the photographer on the file page. The downloaded Wikimedia thumbnail is unchanged locally.

## Loading contract

Vite serves these files locally under `/environment-assets/` and copies this directory, including notices, into the production build. No runtime request to Poly Haven or Wikimedia is required.

- Treat `albedo.jpg` and the street photograph as **sRGB**.
- Treat roughness and normal maps as **linear data / `NoColorSpace`**.
- Normals use **OpenGL** convention; the bundle does not contain DirectX normal maps.
- Source originals are kept unchanged. Runtime tint, tiling and lighting are chosen in the renderer rather than baked into these files.

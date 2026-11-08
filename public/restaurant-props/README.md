# Restaurant prop kit

Two independently usable CC0 props selected for the warm restaurant room. Downloaded from Poly Haven on 2026-11-06. No paid generation was used. Tripo is deferred.

| Runtime file | Source / artist | Bytes | Measured bounds, metres (X × Y × Z) | Geometry |
| --- | --- | ---: | --- | --- |
| `potted_plant_02.glb` | [Potted Plant 02](https://polyhaven.com/a/potted_plant_02), Rico Cilliers | 2,632,276 | 0.701 × 0.841 × 0.657 | 3 meshes, 2 shared materials, 69,806 triangles |
| `ceramic_vase_04.glb` | [Ceramic Vase 04](https://polyhaven.com/a/ceramic_vase_04), James Ray Cock | 595,128 | 0.181 × 0.342 × 0.181 | 1 mesh, 1 material, 9,000 triangles |

Both use embedded 1024 × 1024 JPEG base-color, roughness and OpenGL normal maps. GLBs are self-contained glTF 2.0, Y-up, with no decoder dependency, animations or collision meshes. Runtime payload totals 3,227,404 bytes (3.08 MiB).

## License and provenance

All models and maps are **CC0 1.0 Universal**. Poly Haven explicitly permits commercial use, modifications and redistribution, including in products sold to others: <https://polyhaven.com/license>. The full legal text is bundled in `CC0-1.0.txt`; source license: <https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt>.

Credit is optional under CC0, but appreciated: “Potted Plant 02 by Rico Cilliers and Ceramic Vase 04 by James Ray Cock, via Poly Haven (CC0).”

The exact downloaded 1K glTF, binary buffers and images remain unchanged under `sources/`. `source-manifest.json` records every original download URL, byte size, source-published MD5 and independently calculated SHA-256. Every downloaded file matched its published size and MD5. Poly Haven API provenance:

- <https://api.polyhaven.com/info/potted_plant_02>
- <https://api.polyhaven.com/files/potted_plant_02>
- <https://api.polyhaven.com/info/ceramic_vase_04>
- <https://api.polyhaven.com/files/ceramic_vase_04>

Runtime GLBs embed the original geometry buffers and image bytes without changing them. Packaging removes external image/buffer URLs and writes glTF binary chunks; it does not decimate, recompress or otherwise claim to optimize the source geometry. `packaging-report.json`, `runtime-validation.json` and `SHA256SUMS.txt` record the delivered artifacts.

## Integration

Load `/restaurant-props/potted_plant_02.glb` and `/restaurant-props/ceramic_vase_04.glb` using Three.js `GLTFLoader`. Both source bases are within 0.6 mm of Y=0. To place precisely, compute a world bounding box after loading and translate by `-box.min.y`.

The plant's source bounding-box centre is approximately X=-0.0461, Z=-0.0916; its pot is the useful placement anchor. Keep source nodes together. The vase is centred on X/Z. Scale uniformly to the desired height using `height / box.getSize(size).y`.

Plant node names: `potted_plant_02_pot`, `potted_plant_02_leaves`, `potted_plant_02_dirt`. Its two materials are shared by the three meshes; clone materials only when a particular instance needs its own treatment. Dispose shared geometry, materials and textures only after every instance has finished using them. Use simple authored collision proxies if needed.

The plant is suitable for a few room accents rather than dense instancing at its original triangle count. The vase is empty and can receive the existing authored flower stems. Lamps, pendant lighting and transparent glass remain authored room props to preserve their intended shapes and lighting.

## Validation

Both GLBs loaded through the actual Three.js `GLTFLoader` in headless Chrome against the local Vite server. All nine embedded 1K images decoded, all meshes produced non-empty world bounds, and the objects rendered visibly. `preview.png` is that local render, not a source-site example image. Reported dimensions and triangle counts come from the loaded runtime assets rather than the source page's catalogue estimates.

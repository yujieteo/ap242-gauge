# ap242-gauge

ap242-gauge opens STEP AP242 files (such as CATIA V5) in your browser and measures distances, angles, diameters and radii of features from a reference feature.

It is one HTML file that works offline. It needs no server and no network. It uses occt-import-js (WebAssembly) to read the STEP file.

## Use

1. Download [`ap242-gauge.html` version 1.0.0](https://github.com/yujieteo/ap242-gauge/releases/download/v1.0.0/ap242-gauge.html) (about 10 MB). Open it in a current browser (Chrome, Edge, Firefox or Safari). It works from a local file.
2. Click **Open STEP file**, or drop a `.stp` or `.step` file on the page. The page shows all parts of the file.
3. Select a pick mode and click a reference feature (A), then a second feature (B):
   - Face: a plane, or a cylinder (axis, diameter and radius). Other faces (cone, torus, free form) give their centroid.
   - Edge: the boundary of the clicked face nearest to the click, as a line or a circle (centre, axis, diameter).
   - Point: the mesh vertex nearest to the click.
4. The **Measure** table shows, as applicable:
   - plane to plane: angle, and distance when the planes are parallel
   - plane to axis: angle, and distance when the axis is parallel to the plane
   - axis to axis: angle, and distance between parallel axes or shortest distance between skew axes
   - point to plane, point to axis, and the plain point-to-point distance between the two pick points (with dx, dy, dz)

Lengths are in the length unit of the STEP file (mm, cm, m, inch or foot), read from its `LENGTH_UNIT`. Angles are in degrees.
Drag to rotate, right-drag or shift-drag to pan, use the wheel to zoom.

## How it measures

occt-import-js tessellates each B-rep face of the STEP file into triangles. The mesh vertices lie on the exact CAD surface. The tool fits the vertices of one face:

- plane: least squares (smallest eigenvector of the point covariance)
- cylinder: the axis is the direction normal to all triangle normals. The radius comes from a least squares circle in the plane normal to the axis
- edge: the boundary segments of the face, grown along the boundary, fitted to a line or a circle

![Three panels. a: a plane patch of mesh triangles with its normal n, the direction of least spread of the vertices. b: a faceted cylinder whose triangle normals all point across the axis. c: the view along the axis, where the vertices lie on a least squares circle of radius r.](docs/figures/face-fit.svg)

*Fit of one face: (a) plane normal n, (b) cylinder axis normal to all triangle normals, (c) radius r from a circle across the axis. The 12 facets are illustrative.*

Each fit shows its rms residual. A face fits a plane or a cylinder only when the residual is below 1e-4 of the face size.

## Build and test

You need [Bun](https://bun.sh) 1.4.4.

```sh
bun install
bun run build   # writes dist/ap242-gauge.html
bun test        # no browser
bun run check   # type check, source rules, dead code, tests, dist, page budget, output replay
```

`build.ts` puts into one HTML file: `occt-import-js.js`, the `occt-import-js.wasm` file (base64) and `src/app.ts` with its imports, bundled by `bun build`. The build is deterministic, because it does not minify or compress. CI rebuilds and checks that the committed `dist/` is the same.

The test (`test/nist.test.ts`) loads two NIST AP242 test models with occt-import-js. It fits the faces that the NIST drawings dimension. It compares the values with the drawing values: within 0.001 file units for lengths and 0.01° for angles. See [`test/data/SOURCE.md`](test/data/SOURCE.md) for the files and their source.

`bun run replay` runs the tests on the working tree and records the input of each fit and measurement. It runs these inputs through `src/geom` on the base commit and on the working tree, and fails on each difference. Run `bun run replay -- --accept` to accept a change of the output after you read the diff.

`bun run scripts/figure.ts` renders `docs/figures/face-fit.ts` with the schematic-figure engine and compares the result with `docs/figures/face-fit.svg`.

## Licences

The ap242-gauge source is under the [MIT License](LICENSE). That licence does not cover occt-import-js, Open CASCADE Technology or the NIST test files.

`dist/ap242-gauge.html` contains [occt-import-js](https://github.com/kovacsv/occt-import-js) 0.0.23 by Viktor Kovacs, under the **GNU Lesser General Public License v2.1** (LGPL-2.1). occt-import-js contains Open CASCADE Technology, under LGPL-2.1 with the Open CASCADE exception. The HTML file holds both licence texts (button **Licences**) and a notice at the top. To use a different build of occt-import-js, replace it in `node_modules/occt-import-js` and run `bun run build`.

The NIST test files are a work of the US Government.

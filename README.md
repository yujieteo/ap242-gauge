# ap242-gauge

ap242-gauge opens a STEP AP242 file (for example from CATIA V5) in your browser. You pick a reference feature and a second feature. It gives the distance and the angle between them, and the diameter and radius of holes, shafts and arcs.

It is one HTML file. It works offline, from a local file, with no server and no install. Your model does not leave the page. It reads the STEP file with [occt-import-js](https://github.com/kovacsv/occt-import-js) (Open CASCADE Technology as WebAssembly).

## Use

1. Download [`ap242-gauge.html` version 1.0.1](https://github.com/yujieteo/ap242-gauge/releases/download/v1.0.1/ap242-gauge.html) (about 10 MB). Open it in a current browser (Chrome, Edge, Firefox or Safari).
2. Click **Open STEP file**, or drop a `.stp` or `.step` file on the page. The page shows all parts of the file.
3. Select a pick mode. Click a reference feature (A), then a second feature (B). A third click starts again.
4. Read the values in the **Measure** table.

Drag to rotate. Right-drag or shift-drag to pan. Use the wheel to zoom.

### What a pick gives

| Pick mode | You click | You get |
| --- | --- | --- |
| Face | a flat face | a plane (point and normal) |
| Face | a cylindrical face | an axis, a diameter and a radius |
| Face | a cone, a torus or a free-form face | its centroid, as a point |
| Edge | a straight edge | a line (direction and length) |
| Edge | a circle or an arc | a centre, an axis, a diameter and a radius |
| Edge | any other curved edge | its mid point |
| Point | anywhere on a face | the nearest mesh vertex of that face |

Edge mode uses the boundary of the face that you click. It takes the edge nearest to the click.

### What the Measure table shows

| A and B | Values |
| --- | --- |
| plane and plane | angle, and distance when the planes are parallel |
| plane and axis | angle, and distance when the axis is parallel to the plane |
| axis and axis | angle, and distance between parallel axes or shortest distance between skew axes |
| point and plane, point and axis | distance |
| any two picks | distance between the two pick points, with dx, dy and dz |

Lengths are in the length unit of the STEP file (mm, cm, m, inch or foot). The tool reads the unit from the `LENGTH_UNIT` of the geometric context of the file. Each unit shows a resolution of 0.3 µm or finer. Angles are in degrees.

## How it measures

occt-import-js makes triangles from each B-rep face of the STEP file. The tool fits the mesh vertices of one face:

- plane: least squares (smallest eigenvector of the point covariance)
- cylinder: the first axis is the direction normal to all triangle normals. The tool then turns the axis until the vertices fit a circle best in the plane normal to the axis. The radius comes from that least squares circle
- edge: the boundary segments of the face, followed from the click while the boundary turns less than 40° at each vertex. When all of this run is one line or one circle, that is the edge. When it is not, the tool uses the part around the click: a straight run, or the longest circular arc

![Three panels. a: a plane patch of mesh triangles with its normal n, the direction of least spread of the vertices. b: a faceted cylinder whose triangle normals all point across the axis. c: the view along the axis, where the vertices lie on a least squares circle of radius r.](docs/figures/face-fit.svg)

*Fit of one face: (a) plane normal n, (b) first cylinder axis normal to all triangle normals, (c) radius r from a circle across the axis. The 12 facets are illustrative.*

Each face fit shows its rms residual. A face fits a plane or a cylinder only when the residual is below 1e-4 of the face size. The points of an arc must lie on the circle within 1e-4 of its shortest chord. An arc that is part of a longer run must have at least four points.

## Accuracy and limits

- The tests fit the faces that two NIST drawings dimension. The values agree with the drawings within 0.001 file units for lengths and 0.01° for angles.
- The tests fit all 124 cylinder faces of the two NIST models. Each radius is within 0.005 file units of a radius in the STEP file.
- Most mesh vertices lie on the exact CAD surface. Vertices on an edge where two curved faces meet can lie off the surface, within the edge tolerance of the CAD system. A face with such edges shows a larger rms residual. In the NIST models its diameter is wrong by up to ten times that residual (0.009 mm on a 20 mm diameter).
- The tool does not fit cones, spheres, tori, ellipses or splines. It shows them as a point and says so.
- An arc of fewer than four mesh points that joins other edges smoothly is not measured as a circle. Pick the cylindrical face instead.
- The tool does not read PMI (dimensions and tolerances) from the file. It measures the geometry.

## Build and test

You need [Bun](https://bun.sh) 1.4.4.

```sh
bun install
bun run build   # writes dist/ap242-gauge.html
bun test        # no browser
bun run check   # type check, source rules, dead code, tests, dist, page budget, output replay
```

`build.ts` puts into one HTML file: `occt-import-js.js`, the `occt-import-js.wasm` file (base64) and `src/app.ts` with its imports, bundled by `bun build`. The build is deterministic, because it does not minify or compress. CI rebuilds and checks that the committed `dist/` is the same.

`test/nist.test.ts` loads two NIST AP242 test models with occt-import-js and compares fits with the drawing values and with the radii in the files. `test/properties.test.ts` checks the fits on generated shapes (planes, cylinders, slots, ellipses). See [`test/data/SOURCE.md`](test/data/SOURCE.md) for the files and their source.

`bun run replay` runs the tests on the working tree and records the input of each fit and measurement. It runs these inputs through `src/geom` on the base commit and on the working tree, and fails on each difference. Run `bun run replay -- --accept` to accept a change of the output after you read the diff.

`bun run scripts/figure.ts` renders `docs/figures/face-fit.ts` with the schematic-figure engine and compares the result with `docs/figures/face-fit.svg`.

## Licences

The ap242-gauge source is under the [MIT License](LICENSE). That licence does not cover occt-import-js, Open CASCADE Technology or the NIST test files.

`dist/ap242-gauge.html` contains [occt-import-js](https://github.com/kovacsv/occt-import-js) 0.0.23 by Viktor Kovacs, under the **GNU Lesser General Public License v2.1** (LGPL-2.1). occt-import-js contains Open CASCADE Technology, under LGPL-2.1 with the Open CASCADE exception. The HTML file holds both licence texts (button **Licences**) and a notice at the top. To use a different build of occt-import-js, replace it in `node_modules/occt-import-js` and run `bun run build`.

The NIST test files are a work of the US Government.

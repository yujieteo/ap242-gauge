# ap242-gauge

ap242-gauge opens a STEP AP242 file (for example from CATIA V5) in your browser. You pick a reference feature and a second feature. It gives the distance and the angle between them, and the diameter and radius of holes, shafts and arcs.

It is one HTML file. It works offline, from a local file, with no server and no install. Your model does not leave the page. It reads the STEP file with [occt-import-js](https://github.com/kovacsv/occt-import-js) (Open CASCADE Technology as WebAssembly). The read runs in a worker, so the page stays live. It shows the elapsed time, and you can cancel it. When the browser does not allow the worker, the page reads the file on its main thread. Then the page does not respond until the read ends, and you cannot cancel the read.

## Use

1. Download [`ap242-gauge.html` version 1.2.0](https://github.com/yujieteo/ap242-gauge/releases/download/v1.2.0/ap242-gauge.html) (about 10 MB). Open it in a current browser (Chrome, Edge, Firefox or Safari).
2. Click **Open STEP file**, or drop a `.stp` or `.step` file on the page. The page shows all parts of the file.
3. Select a pick mode. Move the pointer over the model: the feature that a click will pick lights up. Click a reference feature (A), then a second feature (B). Each later click replaces B, and A stays.
4. Read the values in the **Measure** table. The side panel also shows the number of parts, faces and triangles, and the read time.

### Controls

| Action | Mouse or trackpad | Touch | Key |
| --- | --- | --- | --- |
| Rotate about the point under the pointer | drag | drag | |
| Pan | right-drag, middle-drag or shift-drag | two fingers | |
| Zoom to the pointer | wheel or pinch | pinch | |
| Pick mode Face, Edge, Point | buttons at the top left | buttons | F, E, P |
| View Iso, Front, Top, Right | buttons at the top right | buttons | 1, 2, 3, 4 |
| Fit the model in the view | Fit | Fit | Z |
| Swap A and B | Swap A and B | Swap A and B | X |
| Remove one pick | × on its card | × on its card | |
| Clear the picks | Clear | Clear | Esc |

The views take Z as up.

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
| plane and plane | angle between the planes, angle between the normals, and distance: between the planes when they are parallel, or of the centroid of face B from plane A when they are not |
| plane and axis | angle, and distance: of the axis from the plane when it is parallel to the plane, or of the axis point from the plane when it is not |
| axis and axis | angle, and distance between parallel axes or shortest distance between skew axes |
| point and plane, point and axis | distance |
| any two picks | distance between the two feature points, and distance between the two pick points, with dx, dy and dz |

Lengths are in the length unit of the STEP file (mm, cm, m, inch or foot). The tool reads the unit from the `LENGTH_UNIT` of the geometric context of the file. Each unit shows a resolution of 0.3 µm or finer. Angles are in degrees.

### Script the page

The page gives a script or a browser agent the object `window.ap242gauge`:

- `openFile(file)` opens a `File`. It resolves with `opened`, `failed`, `cancelled` or `replaced` (another file was opened before it finished).
- `openStatus` is the state of the file open: `idle`, `waiting` (the STEP reader is still starting), `reading`, `opened`, `failed` or `cancelled`. The `body` element has the same value in its `data-open` attribute.
- `pickAt(x, y)`, `setView(yaw, pitch)`, `project(point)`, `picks`, `model` and `measurements()` pick, move the view and read the results.

`src/open.ts` holds the file-open states and their transitions in the function `nextOpen`. `src/picks.ts` holds the pick states in `nextPicks`.

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
bun install --frozen-lockfile
bun run build   # writes dist/ap242-gauge.html
bun test        # no browser
bun run check   # type check, hot-path check, dead code, tests, build, output replay
```

`build.ts` puts into one HTML file: `occt-import-js.js`, the `occt-import-js.wasm` file (base64), the Inter font (base64), and `src/app.ts` and `src/reader.worker.ts` with their imports, bundled by `bun build`. The page starts the worker from the text of `occt-import-js.js` and the worker bundle. When a browser does not allow that worker, the page reads the file on its main thread. The build is deterministic, because it does not minify or compress. CI runs `bun run check`, which verifies the build succeeds.

`test/nist.test.ts` loads two NIST AP242 test models with occt-import-js and compares fits with the drawing values and with the radii in the files. `test/properties.test.ts` checks the fits on generated shapes (planes, cylinders, slots, ellipses). See [`test/data/SOURCE.md`](test/data/SOURCE.md) for the files and their source.

`bun run replay` runs the tests on the working tree and records the input of each fit and measurement. It runs these inputs through `src/geom` on the base commit and on the working tree, and fails on each difference. A difference listed in `scripts/replay-accepted.json` does not fail. `bun run replay -- --accept` adds the new differences of that run to the file. Run it only after you read the diff, and commit the file. The replay names the entries that match no difference. Remove them when the change is on `main`.

`bun run scripts/figure.ts` renders `docs/figures/face-fit.ts` with the schematic-figure engine and compares the result with `docs/figures/face-fit.svg`. It needs the `schematic-figure` and `schematic-emil` skills in `~/.agents/skills` (or `~/.claude/skills` / `$CLAUDE_CONFIG_DIR/skills`). These skills are not part of this repository. `bun run check` does not run this script, so no check compares `docs/figures/face-fit.svg` with its source.

### Checks

- Run `bun run check` before each commit. It is the one check.
- To run one test, use `bun test test/open.test.ts -t "<name>"`.
- Code in a `*.hot.ts` file must not create objects, arrays, functions or `new` expressions.
- Run `bun run replay -- --accept` only after you have read the diff.

## Licences

The ap242-gauge source is under the [MIT License](LICENSE). That licence does not cover occt-import-js, Open CASCADE Technology or the NIST test files.

`dist/ap242-gauge.html` contains [occt-import-js](https://github.com/kovacsv/occt-import-js) 0.0.23 by Viktor Kovacs, under the **GNU Lesser General Public License v2.1** (LGPL-2.1). occt-import-js contains Open CASCADE Technology, under LGPL-2.1 with the Open CASCADE exception. The HTML file holds both licence texts (button **Licences**) and a notice at the top. To use a different build of occt-import-js, replace it in `node_modules/occt-import-js` and run `bun run build`.

The HTML file also contains a subset of the [Inter](https://github.com/rsms/inter) typeface (`src/fonts/inter.woff2`), under the SIL Open Font License 1.1. Its licence text is in `src/fonts/inter-OFL.txt` and behind the same button.

The NIST test files are a work of the US Government.

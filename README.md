# Logo to PES

Turn a flat logo into a `.pes` embroidery file for Brother and Baby Lock machines, right in your browser. Nothing is uploaded anywhere: the image is processed on your own device.

**Use it:**
- Convert a logo: https://jhoshuac.github.io/logo-to-pes/
- Draw your own design: https://jhoshuac.github.io/logo-to-pes/draw/

## How to use

1. Choose a logo image (PNG or JPG). Flat logos with a few solid colors work best.
2. Pick your hoop and the size of the design.
3. For each color, choose **Stitch** or **Fabric** (Fabric means the fabric shows through and that color is skipped). Change the thread colors if you like. The page shows the name your machine will use for each color.
4. Check the stitch preview, then press **Download .pes**.
5. Copy the `.pes` file to a USB stick and load it on the machine.

Sew a test on scrap fabric with stabilizer before the real garment.

## Draw your own design

The drawing page works like a simple paint program sized to the hoop: brush, eraser, line, box, circle, fill and text, in Brother thread colors, with a 10 mm grid. Press **Make stitches** to see the stitches, then **Download .pes**. Lines thinner than 1 mm and letters under 5 mm tall are hard to sew. The drawing is kept in your browser between visits.

## Cómo usarlo (Español)

1. Elige la imagen del logo (PNG o JPG). Funcionan mejor los logos planos con pocos colores sólidos.
2. Elige el bastidor y el tamaño del diseño.
3. Para cada color, elige **Bordar** o **Tela** (Tela significa que se ve la tela y ese color no se borda).
4. Revisa la vista previa y pulsa **Descargar .pes**.
5. Copia el archivo `.pes` a una memoria USB y cárgalo en la máquina.

Para dibujar tu propio diseño, abre https://jhoshuac.github.io/logo-to-pes/draw/ (pincel, borrador, línea, caja, círculo, relleno y texto). Pulsa **Crear puntadas** y luego **Descargar .pes**.

## How it works

- Colors are found automatically, then each color area is turned into stitches: wide areas get a tatami fill with underlay, narrow parts (lines, lettering, feather tips) get satin columns.
- The `.pes` file starts the design at its top-left corner, which Brother machines such as the SE625 expect.
- The file layout matches a `.pes` file confirmed to load and sew on a Brother SE625 with a 4×4 in hoop.

## Files

- `index.html`: the whole site in one file (what GitHub Pages serves).
- `src/engine.js`: the stitch engine (color separation, fills, satins, PES writer).
- `draw/index.html`: the drawing tool, also one file.
- `src/template.html`, `src/draw-template.html`: the two pages before the engine is inlined.
- `src/build.py`: rebuilds both pages from the files in `src/` (`python3 src/build.py`).

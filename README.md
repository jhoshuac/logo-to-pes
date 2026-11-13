# Logo to PES

Turn a flat logo into a `.pes` embroidery file for Brother and Baby Lock machines, right in your browser. Nothing is uploaded anywhere: the image is processed on your own device.

**Use it:**
- Convert a logo: https://jhoshuac.github.io/logo-to-pes/
- Draw your own design: https://jhoshuac.github.io/logo-to-pes/draw/

## How to use

1. Choose a logo image (PNG or JPG). Flat logos with a few solid colors work best.
2. Pick your hoop and the size of the design.
3. For each color, choose **Stitch** or **Fabric** (Fabric means the fabric shows through and that color is skipped). Change the thread colors if you like. The page shows the name your machine will use for each color.
4. Set the **stitch density**. The default is 3.3 lines per mm (rows 0.30 mm apart). If the fabric shows through the stitches, move it toward Denser.
5. Check the stitch preview, then press **Download .pes**.
6. Copy the `.pes` file to a USB stick and load it on the machine.

Every visit starts blank. Nothing you upload or draw is saved.

Sew a test on scrap fabric with stabilizer before the real garment.

## Draw your own design

The drawing page works like a simple paint program sized to the hoop: select, brush, eraser, line, box, circle, fill and text, in Brother thread colors, with a 10 mm grid. To move something, use **Select**: drag a box around it, then drag inside the box. New text stays selected after you press Enter, so you can drag it right away. Arrow keys nudge a selection and Delete removes it. Set the stitch density, press **Make stitches** to see the stitches, then **Download .pes**. Lines thinner than 1 mm and letters under 5 mm tall are hard to sew. Every visit starts with a blank page, so download the `.pes` before closing it.

## Cómo usarlo (Español)

1. Elige la imagen del logo (PNG o JPG). Funcionan mejor los logos planos con pocos colores sólidos.
2. Elige el bastidor y el tamaño del diseño.
3. Para cada color, elige **Bordar** o **Tela** (Tela significa que se ve la tela y ese color no se borda).
4. Ajusta la **densidad de puntada**. Si la tela se ve entre las puntadas, muévela hacia Más densa.
5. Revisa la vista previa y pulsa **Descargar .pes**.
6. Copia el archivo `.pes` a una memoria USB y cárgalo en la máquina.

Cada visita empieza en blanco. No se guarda nada de lo que subes o dibujas.

Para dibujar tu propio diseño, abre https://jhoshuac.github.io/logo-to-pes/draw/ (seleccionar, pincel, borrador, línea, caja, círculo, relleno y texto). Para mover algo, usa **Seleccionar**: arrastra un recuadro alrededor y luego arrastra dentro del recuadro. Pulsa **Crear puntadas** y luego **Descargar .pes**.

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

# Logo to PES

Turn a flat logo into a `.pes` embroidery file for Brother and Baby Lock machines, right in your browser. Nothing is uploaded anywhere: the image is processed on your own device.

**Use it:**
- Convert a logo: https://jhoshuac.github.io/logo-to-pes/
- Draw your own design: https://jhoshuac.github.io/logo-to-pes/draw/

## How to use

1. Choose a logo image (PNG or JPG). Flat logos with a few solid colors work best.
2. Pick your hoop and the size of the design.
3. For each color, choose **Stitch** or **Fabric** (Fabric means the fabric shows through and that color is skipped). Change the thread colors if you like. The page shows the name your machine will use for each color.
4. Under **Background**, choose whether to remove the background (the default; darker or lighter shades of it, like drop shadows and soft edges, go with it), remove it but keep that color where it appears inside the logo, or keep it and stitch it like a patch. **Tap to remove** lets you tap any area in the preview to take it out; **Restore removed areas** brings them back.
5. Under **Fabric and stitches**, pick what you're stitching on (cotton, T-shirt, polo, denim, towel, fleece). That sets the density, pull compensation and underlay, and shows a stabilizer tip. Fine-tune the **stitch density** if needed, and tick **Basting box** to sew a removable box first that holds the fabric and stabilizer. **Thicken thin lines** (on by default) makes lines thinner than 1 mm about 1 mm wide, since thinner ones break up or vanish when sewn. The default is 3.3 lines per mm (rows 0.30 mm apart). If the fabric shows through the stitches, move it toward Denser.
6. Check the stitch preview, then press **Download .pes**. To change the logo first (add text, erase or move parts), press **Edit this logo in the drawing editor**.
7. Copy the `.pes` file to a USB stick and load it on the machine.

Every visit starts blank. Nothing you upload or draw is saved.

Sew a test on scrap fabric with stabilizer before the real garment.

## Draw your own design

The drawing page works like a simple paint program sized to the hoop: select, brush, eraser, line, box, circle, fill and text, in Brother thread colors, with a 10 mm grid. To move something, use **Select**: drag a box around it, then drag inside the box. With the Text tool, a text bar under the hoop sets the font, letter size and shape (straight or arched). New text stays selected after you press Enter: drag it, and change its words, font, size, shape or thread color, and it's redrawn sharp each time. Press **Done** to put it down. **Open .pes** brings in an existing embroidery file. Its stitches stay exactly as they are; you can move, rotate and flip it (resizing works only a little, about 80–120%, because stitches aren't recalculated) and add a name or shapes, then save everything as one .pes. **Image** brings a picture or logo into the drawing in thread colors, with its background (and the background's shades) left out. While it's still selected, a **Picture** panel under the hoop lets you tap each color to sew it or leave it out, change the number of colors (up to 12), keep the background color where it sits inside the design (white sparkles or highlights on a white background), and turn **Thicken thin lines** on or off; resizing it with − / + redraws it from the original picture so details stay sharp. Press **Done** to put it down. **Remove background** clears the background around the selection (or around the whole drawing), and **Erase area** removes whatever connected area you tap. Arrow keys nudge a selection and Delete removes it; the selection bar can also rotate (15° steps), flip and resize it. There are 32 fonts in four groups (Classic, Script, Sport & vintage, Fun & storybook), all free for commercial use (Open Font License or Apache 2.0); **See all fonts** shows your words in every font, and each one lists its smallest sewable letter height. The **Text and monograms** panel also has a 3-letter monogram builder. Set the stitch density, press **Make stitches** to see the stitches, then **Download .pes**. Lines thinner than 1 mm and letters under 5 mm tall are hard to sew. **Clear all** empties the hoop in one tap (Undo brings it back). **Zoom** with the − / + buttons, Ctrl + scroll wheel, a trackpad pinch, or two fingers on a phone; **Fit** shows the whole hoop. In the Stitches view you can zoom up to 3200% to see each stitch and its needle points, with a scale bar in the corner. **Watch it sew** (both pages, only when you press it) replays the design in the order the machine sews it: the needle moves, each thread color appears in turn, it stops at every thread change and shows the jump threads you'll need to cut. Pick the speed, drag the slider to any point, or press **Show finished**. Drag to move around (in the drawing, hold Space and drag, or use two fingers). Every visit starts with a blank page, so download the `.pes` before closing it.

## Cómo usarlo (Español)

1. Elige la imagen del logo (PNG o JPG). Funcionan mejor los logos planos con pocos colores sólidos.
2. Elige el bastidor y el tamaño del diseño.
3. Para cada color, elige **Bordar** o **Tela** (Tela significa que se ve la tela y ese color no se borda).
4. Ajusta la **densidad de puntada**. Si la tela se ve entre las puntadas, muévela hacia Más densa.
5. Revisa la vista previa y pulsa **Descargar .pes**.
6. Copia el archivo `.pes` a una memoria USB y cárgalo en la máquina.

Cada visita empieza en blanco. No se guarda nada de lo que subes o dibujas.

Para dibujar tu propio diseño, abre https://jhoshuac.github.io/logo-to-pes/draw/ (seleccionar, pincel, borrador, línea, caja, círculo, relleno y texto). Para mover algo, usa **Seleccionar**: arrastra un recuadro alrededor y luego arrastra dentro del recuadro. Pulsa **Crear puntadas** y luego **Descargar .pes**. Al traer una imagen con **Imagen**, el fondo y sus sombras quedan fuera; mientras sigue seleccionada, el panel **Imagen** deja tocar cada color para bordarlo o dejarlo fuera, y **Engrosar líneas finas** ensancha las líneas de menos de 1 mm para que se borden. Para acercar, usa los botones − / +, Ctrl + rueda del ratón o pellizca con dos dedos; **Ajustar** muestra todo el bastidor. En la vista de Puntadas puedes acercar hasta 3200% para ver cada puntada.

Features still to come are listed in [PENDING.md](PENDING.md).

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

# Pending features

Features found in embroidery programs (Brother PE-Design, Hatch, Embrilliance, Ink/Stitch, Wilcom) that the site doesn't have yet. The machine in use is a **Brother SE625**: 4 × 4 in (100 × 100 mm) sewing field, designs loaded by USB, no Wi-Fi.

## Works on the SE625 (next in line)

| Feature | What it does | Notes |
|---|---|---|
| Thin lines as running / triple (bean) stitch | Fine details sewn as a thin line instead of being widened to a 1 mm satin | Plain stitches, works on any machine |
| Appliqué | Placement line, tack-down and satin border so a fabric piece fills a large area | Uses the machine's color stops to pause for placing and trimming the fabric |
| More lettering fonts | More choices beyond the 4 in the editor | Each with its smallest sewable size |
| Sew-out simulator | Watch the stitches sew in order before going to the machine | Runs in the browser only |
| Print a real-size template | Paper template to position the design on the garment | Runs in the browser only |

## Low priority (not useful on the SE625)

| Feature | Why it waits |
|---|---|
| Save as .dst | The SE625 reads .pes, which already works |
| Bigger hoops (5 × 7, 6 × 10) | Already in the menu for other machines, but larger than the SE625's 4 × 4 field |
| Multi-hoop splitting | Needs multi-position hoops; the SE625 has the single 4 × 4 hoop |
| Wireless transfer | The SE625 has no Wi-Fi; designs go by USB |
| Photo stitch, quilting and decorative fills | Heavy for a browser tool and of little use in a 4 × 4 field |
| Automatic color sort | Not needed: each color is already sewn in one go, so there is one stop per color |

## Done

- Fabric presets (cotton, T-shirt, polo, denim, towel, fleece) that set density, pull compensation and underlay, with a stabilizer tip
- Basting box sewn first in its own color stop
- Curved text (arch up / arch down), 4 fonts with minimum sizes, and 3-letter monograms
- Rotate, flip and resize a selection in the editor
- Open an existing .pes in the editor: its stitches are kept exactly, it can be moved, rotated, flipped and resized a little (80–120%), and text or drawings can be added before saving one combined .pes
- Zoom in the editor (up to 3200%), with the Stitches view redrawn sharp at every level so single stitches and needle points are visible
- Background removal also takes the background's shades (drop shadows, glows, soft edges), on both pages
- Thicken thin lines (under 1 mm) so they sew, on both pages; a Picture panel in the editor to choose which colors of an imported picture are sewn, with sharp resizing from the original
- Better automatic colors for colorful logos: colors are learned from flat areas only (no soft edges), measured against the design rather than the whole picture, up to 12 colors

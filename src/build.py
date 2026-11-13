"""Rebuild ../index.html: inlines engine.js and the example logo into template.html."""
import base64, pathlib
src = pathlib.Path(__file__).parent
t = (src / 'template.html').read_text()
eng = (src / 'engine.js').read_text()
uri = 'data:image/jpeg;base64,' + base64.b64encode((src / 'example-logo.jpg').read_bytes()).decode()
t = t.replace('/*ENGINE*/', eng).replace('EXAMPLE_DATA_URI', uri)
(src.parent / 'index.html').write_text(t)
print('wrote index.html', len(t), 'bytes')

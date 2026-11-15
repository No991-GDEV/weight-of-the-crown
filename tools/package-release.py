"""Build the installable ZIP and manifest; only module runtime files are included."""
from pathlib import Path
import hashlib
import json
import zipfile
root=Path(__file__).resolve().parents[1]
out=root/'dist'
out.mkdir(exist_ok=True)
manifest=json.loads((root/'module.json').read_text(encoding='utf-8'))
files=[root/n for n in ['module.json','README.md','PROCEDENCIA.md']]
for folder in ['src','scripts','styles','templates']:
    files+=sorted(p for p in (root/folder).rglob('*') if p.is_file())
archive=out/'weight-of-the-crown.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(set(files)):
        z.write(p,manifest['id']+'/'+p.relative_to(root).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    inside=json.loads(z.read(manifest['id']+'/module.json'))
    assert inside==manifest
    assert not any('..' in Path(n).parts for n in z.namelist())
    assert all(n.startswith(manifest['id']+'/') for n in z.namelist())
    assert manifest['id']+'/scripts/main.js' in z.namelist()
(out/'module.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
checksums={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [archive,out/'module.json']}
(out/'SHA256SUMS.txt').write_text(''.join(f'{digest}  {name}\n' for name,digest in checksums.items()),encoding='utf-8')
print(json.dumps({'version':manifest['version'],'files':len(files),'sha256':checksums},indent=2))

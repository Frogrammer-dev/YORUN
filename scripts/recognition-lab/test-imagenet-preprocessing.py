"""Independent synthetic checks; these are not ImageNet quality measurements."""
import importlib.util,json,tempfile
from pathlib import Path
import numpy as np
from PIL import Image

spec=importlib.util.spec_from_file_location('c',Path(__file__).with_name('imagenet-contours.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
with tempfile.TemporaryDirectory(dir=Path('eval/recognition/imagenet-contour-20261028').resolve()) as temp:
    root=Path(temp)
    Image.new('RGB',(40,40),'blue').save(root/'photo.png')
    mask=np.zeros((40,40),dtype=np.uint8);mask[8:32,8:32]=255
    Image.fromarray(mask).save(root/'mask.png')
    record={'id':'synthetic','label':'square','source':'synthetic test','image':'photo.png','mask':'mask.png','reviewed':True}
    (root/'manifest.json').write_text(json.dumps([record]))
    c.run(root/'manifest.json',root/'result.json')
    result=json.loads((root/'result.json').read_text())
    assert len(result['accepted'])==1
    a=result['accepted'][0]
    assert len(a['featureInput'])==len(a['uniformInput'])==16
    assert len(a['featureSelection']['mandatory'])==4
    record['reviewed']=False
    (root/'manifest.json').write_text(json.dumps([record]))
    c.run(root/'manifest.json',root/'result.json')
    assert len(json.loads((root/'result.json').read_text())['accepted'])==0
print('PASS: mask importer -> feature inputs, all four corners retained, unreviewed masks rejected')

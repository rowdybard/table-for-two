"""Check source choice coverage and editable OOXML before visual review."""
from pathlib import Path
from zipfile import ZipFile
import json
from lxml import etree
from docx import Document

root=Path(__file__).resolve().parents[1]
folder=root/'docs'/'artifacts'
data=json.loads((folder/'encounter-atlas-data.json').read_text(encoding='utf8'))
path=folder/'Restaurant Encounter Atlas.docx'
document=Document(path)
with ZipFile(path) as archive:
    xml=etree.fromstring(archive.read('word/document.xml'))
    ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    text='\n'.join(xml.xpath('//w:t/text()',namespaces=ns))
    choices=[choice for track in data['scenarios'] for choice in track['choices']+track['endings']]
    missing=[choice['label'] for choice in choices if choice['label'] not in text]
    assert not missing,missing
    overrides=[label for track in data['scenarios'] for choice in track['choices'] for label in choice.get('followLabels',{}).values()]
    assert all(label in text for label in overrides)
    assert all(agenda['goal'].rstrip('.') in text and agenda['understood'] in text and agenda['respected'] in text for agenda in data['agendas'])
    assert not xml.xpath('//w:drawing|//w:pict',namespaces=ns),'The atlas must remain native editable text and tables.'
    bookmarks=set(xml.xpath('//w:bookmarkStart/@w:name',namespaces=ns))
    links=xml.xpath('//w:hyperlink/@w:anchor',namespaces=ns)
    assert all(link in bookmarks for link in links),'Broken internal navigation.'
    assert len(choices)==51 and len(data['scenarios'])==11 and data['counts']['decisionHistories']==58
    assert len(data['agendas'])==16
print(json.dumps({'docx':str(path),'exactChoicesCovered':len(choices),'branchLabelOverridesCovered':len(overrides),'agendasCovered':len(data['agendas']),'internalLinks':len(links),'nativeEditableTrees':True,'embeddedImages':0,'fileBytes':path.stat().st_size},indent=2))

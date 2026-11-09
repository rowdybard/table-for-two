"""Build the editable design atlas from the audited restaurant catalogue."""
from pathlib import Path
from datetime import datetime
import json
import re
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.section import WD_ORIENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'artifacts'
DATA = json.loads((OUT / 'encounter-atlas-data.json').read_text(encoding='utf8'))
DOC = Document()
SEC = DOC.sections[0]
SEC.orientation = WD_ORIENT.LANDSCAPE
SEC.page_width, SEC.page_height = Inches(11), Inches(8.5)
SEC.top_margin = SEC.bottom_margin = Inches(.52)
SEC.left_margin = SEC.right_margin = Inches(.64)
SEC.header_distance = SEC.footer_distance = Inches(.22)
WIDTH = 9.72

for name in ['Normal', 'Body Text', 'Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Heading 3']:
    style = DOC.styles[name]
    style.font.name = 'Arial'
    style.font.color.rgb = RGBColor.from_string('000000')
    style._element.get_or_add_rPr().rFonts.set(qn('w:ascii'), 'Arial')
    style._element.rPr.rFonts.set(qn('w:hAnsi'), 'Arial')
DOC.styles['Normal'].font.size = Pt(10.5)
DOC.styles['Normal'].paragraph_format.line_spacing = 1.08
DOC.styles['Normal'].paragraph_format.space_after = Pt(5)
DOC.styles['Title'].font.size = Pt(32)
DOC.styles['Title'].paragraph_format.space_after = Pt(9)
DOC.styles['Subtitle'].font.size = Pt(12)
DOC.styles['Heading 1'].font.size = Pt(22)
DOC.styles['Heading 1'].paragraph_format.space_before = Pt(0)
DOC.styles['Heading 1'].paragraph_format.space_after = Pt(8)
DOC.styles['Heading 2'].font.size = Pt(13.5)
DOC.styles['Heading 2'].paragraph_format.space_before = Pt(10)
DOC.styles['Heading 2'].paragraph_format.space_after = Pt(4)
DOC.styles['Heading 3'].font.size = Pt(11)
DOC.styles['Heading 3'].paragraph_format.space_before = Pt(7)
DOC.styles['Heading 3'].paragraph_format.space_after = Pt(3)
for name in ['Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Heading 3']:
    DOC.styles[name].paragraph_format.keep_with_next = True
    for border in DOC.styles[name]._element.xpath('.//w:pBdr'):
        border.getparent().remove(border)

footer = SEC.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
run = footer.add_run('Table for Two   |   ')
run.font.size = Pt(8)
field = OxmlElement('w:fldSimple'); field.set(qn('w:instr'), 'PAGE')
footer._p.append(field)
DOC.core_properties.title = 'Restaurant Encounter Atlas'
DOC.core_properties.subject = 'Editable authored encounter trees and source audit for Table for Two'
DOC.core_properties.author = 'Table for Two'
DOC.core_properties.keywords = 'restaurant, encounters, choices, agendas, endings, design audit'

bookmark_id = 0
page_titles = []

def p(text='', bold=False, size=None, after=5, before=0, color=None):
    item = DOC.add_paragraph()
    item.paragraph_format.space_after = Pt(after)
    item.paragraph_format.space_before = Pt(before)
    run = item.add_run(text)
    run.bold = bold
    if size: run.font.size = Pt(size)
    if color: run.font.color.rgb = RGBColor.from_string(color)
    return item

def heading(text, level=1, bookmark=None):
    global bookmark_id
    item = DOC.add_paragraph(text, f'Heading {level}')
    if bookmark:
        bookmark_id += 1
        start = OxmlElement('w:bookmarkStart'); start.set(qn('w:id'), str(bookmark_id)); start.set(qn('w:name'), bookmark)
        end = OxmlElement('w:bookmarkEnd'); end.set(qn('w:id'), str(bookmark_id))
        item._p.insert(0, start); item._p.append(end)
    return item

def page(title, bookmark=None):
    DOC.add_page_break()
    page_titles.append(title)
    return heading(title, bookmark=bookmark)

def source(text):
    p(text, size=8, after=0, before=7, color='5B6168')

def tree(label, details='', level=0, last=False, bold=True):
    item = DOC.add_paragraph()
    item.paragraph_format.left_indent = Inches(.18 + level * .23)
    item.paragraph_format.first_line_indent = Inches(-.18)
    item.paragraph_format.space_after = Pt(5)
    item.paragraph_format.keep_together = True
    prefix = item.add_run(('└─ ' if last else '├─ ') if level >= 0 else '')
    prefix.font.name = 'Consolas'; prefix.font.size = Pt(10)
    run = item.add_run(label); run.bold = bold
    if details:
        run = item.add_run('\n' + details)
        run.font.size = Pt(10)
        run.font.color.rgb = RGBColor.from_string('3F454C')
    return item

def table(headers, rows, widths, small=9.5):
    t = DOC.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    for column,width in zip(t.columns,widths): column.width=Inches(width)
    for cell, width, text in zip(t.rows[0].cells, widths, headers):
        cell.width = Inches(width); cell.text = str(text)
    repeat = OxmlElement('w:tblHeader'); t.rows[0]._tr.get_or_add_trPr().append(repeat)
    for row in rows:
        cells = t.add_row().cells
        for cell, width, text in zip(cells, widths, row):
            cell.width = Inches(width); cell.text = str(text)
    borders = OxmlElement('w:tblBorders')
    for name in ['top','left','bottom','right','insideH','insideV']:
        border=OxmlElement('w:'+name); border.set(qn('w:val'),'single'); border.set(qn('w:sz'),'5'); border.set(qn('w:color'),'D9D9D9'); borders.append(border)
    t._tbl.tblPr.append(borders)
    margins=OxmlElement('w:tblCellMar')
    for edge in ['top','bottom','left','right']:
        node=OxmlElement('w:'+edge);node.set(qn('w:w'),'85');node.set(qn('w:type'),'dxa');margins.append(node)
    t._tbl.tblPr.append(margins)
    for i,row in enumerate(t.rows):
        no_split=OxmlElement('w:cantSplit');row._tr.get_or_add_trPr().append(no_split)
        for j,cell in enumerate(row.cells):
            cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
            shade=OxmlElement('w:shd');shade.set(qn('w:fill'),'243447' if i==0 else 'F4F6F8' if i%2==0 else 'FFFFFF');cell._tc.get_or_add_tcPr().append(shade)
            for para in cell.paragraphs:
                para.paragraph_format.space_after=Pt(2);para.paragraph_format.line_spacing=1.03
                if j and len(headers)==4: para.alignment=WD_ALIGN_PARAGRAPH.CENTER
                for run in para.runs:
                    run.font.name='Arial';run.font.size=Pt(small);run.bold=i==0;run.font.color.rgb=RGBColor.from_string('FFFFFF' if i==0 else '000000')
    p('', after=2)
    return t

def internal_link(paragraph, text, anchor):
    link=OxmlElement('w:hyperlink');link.set(qn('w:anchor'),anchor)
    run=OxmlElement('w:r');props=OxmlElement('w:rPr');color=OxmlElement('w:color');color.set(qn('w:val'),'243447');props.append(color);under=OxmlElement('w:u');under.set(qn('w:val'),'single');props.append(under);run.append(props);txt=OxmlElement('w:t');txt.text=text;run.append(txt);link.append(run);paragraph._p.append(link)

# Scope and inventory
DOC.add_paragraph('Restaurant Encounter Atlas', 'Title')
DOC.add_paragraph('Table for Two  |  Design reference  |  9 November 2026', 'Subtitle')
p('The restaurant currently contains 11 seeded two-beat stories, plus three separately scheduled physical interruptions. Across the story catalogue there are 58 complete two-choice histories. Most routes rejoin the same follow-through beat, so 58 histories should not be read as 58 different plots or 58 events in one evening.', size=12, after=12)
table(['Content layer','Verified amount','What a player can meet'],[
    ['Seeded stories','11 alternatives','One selected story per Solo or Blind evening; one shared story per Double room.'],
    ['Player choice records','51','29 opening options and 22 follow-through options across the story catalogue.'],
    ['Complete story histories','58','An opening choice followed by a valid final choice; seven stories have six histories, four have four.'],
    ['Physical interruptions','3','Wrong order, spilled water, disruptive diner; separately gated, not guaranteed.'],
    ['Date agendas','16 wants','Private goals assigned independently of the three preset character biographies.'],
    ['Ending kinds','6','Another evening, friendship, second chance, quiet goodbye, early exit, or boundary departure.'],
], [2.0,1.45,6.27], small=10)
heading('How to read this atlas',2)
p('The story trees keep each authored player choice editable in Word. Opening branches merge into a shared follow-through decision; branch-specific wording changes are written beside the affected branch. Result lines distinguish recorded facts, visible emotion, and consequential state changes. NPC wording can vary with personality without creating another player-choice route.')
p('This is a design reference with private agenda goals, ending conditions and implemented physical consequences across all three modes. Its review distinguishes deliberate story convergence from gameplay defects that have now been fixed. AI conversation is open-ended within the server’s turn and text limits; it does not have a meaningful fixed number of narrative leaves.')
source('Source coverage: src/restaurant/scenarios.ts and scenario-types.ts; server/restaurant/evening.ts, scenario.ts, agendas.ts, skepticism.ts, boundaries.ts and chemistry.ts; Double room controllers and supporting activities.')

page('Encounter index','encounter_index')
rows=[]
for s in DATA['scenarios']:
    rows.append([s['title'],s['firstChoiceCount'],s['followChoiceCount'],s['histories']])
rows.append(['Catalogue total',29,22,58])
t=table(['Story','Opening options','Follow-through options','Complete histories'],rows,[5.2,1.35,1.75,1.42],small=10)
for i,s in enumerate(DATA['scenarios'],1):
    cell=t.rows[i].cells[0];cell.paragraphs[0].clear();internal_link(cell.paragraphs[0],s['title'],'story_'+s['id'].replace('-','_'))
heading('Other maps',2)
maps=[('Modes and the evening flow','modes'),('Implementation review','review'),('Physical interruptions','physical'),('Activities and small gestures','activities'),('Understanding and the sixteen agendas','agenda'),('Boundaries and recovery','boundaries'),('Earned Dolphin access','chemistry'),('Farewell and endings','endings'),('Characters and Blind Date variation','characters'),('Source coverage','sources')]
for index in range(0,len(maps),2):
    item=p('',after=4)
    item.paragraph_format.tab_stops.add_tab_stop(Inches(5.15))
    internal_link(item,*maps[index]);item.add_run('\t');internal_link(item,*maps[index+1])
source('There are 22 authored decision beats and 51 choice records, or 73 decision/choice nodes in these merged story maps. Each story has two terminal choice records; the expanded history tree has four or six leaves because the earlier choice remains part of memory.')

page('Modes and the evening flow','modes')
table(['Mode','People and ownership','Selection and consequences'],[
    ['Solo date','One human, one AI date, waiter and nearby diner.','Preset biography; story chosen by the session seed; one agenda for that evening.'],
    ['Double date','Two humans and two independent AI dates share one table.','Both friends choose distinct presets and ready up. One shared story targets a pair; either seated connected friend can answer. Agendas and outcomes remain per pair.'],
    ['Blind date','One human, one seeded AI personality, waiter and diner.','Seed selects reusable appearance, biography ingredients, traits, agenda and one story. The same seed reproduces the setup.'],
],[1.3,3.25,5.17],small=10)
heading('Dinner flow',2)
tree('Arrive and sit','The human walks to the table. Seating and movement are authoritative game state.')
tree('Choose one of three main courses','Eli nudges an unopened menu after 40 scene seconds. Food takes 45 active kitchen seconds; a care hold preserves the remaining cooking time. Try three bites (at least 500 ms apart). Eli clears the plates 200 seconds after service, 60 seconds after the cutlery is rested across the plate, or 90 seconds after the third bite.')
tree('Spend time together','Conversation, a seeded story, conditional physical interruptions and small gestures happen here. The date breaks a long silence with an authored line of their own, at most four per evening, without a model call. The line waits while the two are mid-conversation or a reply is still being written, a scripted aside is dropped when the human has just been talking, and a line that asks something is carried into the next model note as a question still waiting for its answer (it expires after 90 scene seconds). An authored line never counts as a human turn.')
tree('Dessert decision','Eli offers dessert as the plates go. Choose lemon, chocolate or berries, or skip it; after 40 scene seconds the date suggests their favourite, or declines when guarded or hurt. Dessert takes 20 kitchen seconds and is shared from one plate; it finishes 75 seconds after service or 40 seconds after two spoonfuls. Eli brings one check 12 seconds after dessert ends or is declined.')
tree('Settle dinner and say goodbye','Three settlement options; then stand and walk to the entrance for one of three farewell requests.',last=True)
heading('Shared story arrival gate',2)
p('Solo and Blind: seated, date present, no requested bill, active incident or departure; calm and quiet windows must have expired. Most stories need a served or finished main and four minutes elapsed OR four completed dialogue turns. The unwell story is an exception: it can interrupt a waiting order after 12 scene seconds, or a served plate before three bites after 90 seconds OR two dialogue turns.')
p('Double: the target pair must meet the same physical eligibility and story-specific gate. The active table must be clear of incidents and farewells, with 25-second spacing and quiet windows respected. Ordinary shared stories also need four minutes on the minimum active-pair clock OR four dialogue turns across active pairs. A dormant story retargets if its pair has left; an active story closes if its subject leaves.')
source('server/restaurant/evening.ts EveningDirector.step; server/double-date/scenarios.ts initializeScenario, tickScenario and resolveScenario; server/double-date/scene.ts.')

heading('How the date hears the evening',2)
p('Every mode sends a stable system prompt, a named transcript and a short prose note. Table events are facts the date cannot rewrite; its notebook holds only what was said. Talking over the date, an unanswered question or “what do you mean?” are noted from what happened. No model call was added.')
source('server/restaurant/turn-note.ts, dialogue-policy.ts and table-facts.ts; server/double-date/table-note.ts and conversation.ts.')

page('Implementation review','review')
heading('Food mistakes now arrive with service',2)
p('The earlier late replacement has been removed. A wrong order can be introduced when the main is delivered, before any bite. An eaten plate cannot be replaced by a provider redirect. The kept replacement is labelled on the receipt at the original ordered price. Recovery remains a ticket comparison followed by return or acceptance.')
heading('Later interruptions are independent opportunities',2)
p('The water spill belongs to the main course: a minute after service, or the next calm moment before dessert reaches the table. The noisy diner belongs to dessert: half a minute after it is served. Neither needs a previous incident to have occurred, and interruptions land before a course moves on. They are conditional opportunities, not three guaranteed events per evening: a skipped dessert has no neighbor to deal with, and moving to the quieter table prevents the noisy-diner interruption.')
heading('Medical departures finalize the affected pair',2)
p('The Double care exit now finalizes the departing pair’s agenda goal and reflection, locks chemistry and settles that pair once. The friend’s agenda, food and bill remain independent and playable. The deterministic comparison covers both human seats and all three care-departure stories without a provider request.')
heading('Many choices change the account of the evening rather than the destination',2)
p('Every first choice reaches the same two final choices for its story, although the follow-through description, reaction or labels may change. The catalogue has 58 complete histories but only 22 terminal option records. In several stories both endings continue dinner; the difference is the recorded choice and response. Keep this distinction when judging replay value.')
heading('Care and attraction paths have deliberate limits',2)
p('Both allergy endings and both excessive-drinking endings finish dinner for care. Attraction uncertainty closes romance after the first response; friendship cannot be persuaded back into romance. The tic disclosure offers considerate responses without making the disability a punishment. These are clear state rules; a higher agenda score does not override them.')
heading('Practical choices have physical state',2)
p('Care holds stop cooking and course use; privacy and cleanup move the date away, then back before dinner resumes. Extra dishes are served, cancelled, shared or boxed, with an itemized bill. Wine cleanup clears the stain and uses the cloth. A quieter-table choice moves actors, props, targets and the collision body together. These systems do not award automatic affection.')
source('Source and deterministic verification: scenario-care.ts, scenario-effects.ts, tests/atlas-fixes.test.ts, analyze-encounter-atlas.mjs and verify-encounter-atlas-audit.mjs. The remaining merged-story structure is an authored design choice, not an unresolved simulation bug.')

# Every authored story is one editable merged tree.
FOLLOW_NOTES={
    ('wine-spill','ask-first'):'They take the cloth and ask you to clear the glasses.',
    ('wine-spill','get-eli'):'Eli offers a quieter clean-up space; the date chooses how to recover.',
    ('wine-spill','own-mishap'):'The joke lands unevenly; practical help is still needed.',
    ('oversized-order','help'):'The unprepared dishes are cancelled; agree what to share.',
    ('oversized-order','joke'):'They choose a first dish, but the excess food still needs a plan.',
    ('oversized-order','wait'):'The date realizes sharing was never agreed.',
    ('staff-flirt','be-clear'):'They turn back to hear the concern behind the question.',
    ('staff-flirt','light-joke'):'They laugh, then check whether you were actually bothered.',
    ('staff-flirt','not-bothered'):'They ask whether the banter was comfortable or should stop.',
    ('awkward-ex','check-in'):'They give a brief explanation and take a breath.',
    ('awkward-ex','make-space'):'They do not want the ex to become the evening’s focus.',
    ('awkward-ex','change-subject'):'They are briefly distracted, then return to the conversation.',
    ('family-visit','welcome'):'The relative starts another story; your date signals for an exit.',
    ('family-visit','boundary'):'The relative starts saying goodbye; your date relaxes.',
    ('family-visit','follow-lead'):'Your date takes over their own story and decides where it ends.',
}

def effects_text(effects, scenario_id):
    parts=[]
    if effects.get('romanceClosed'): parts.append('Romance remains closed for this evening.')
    if effects.get('earlyExit'):
        if scenario_id in ['allergic-reaction','too-many-drinks','feeling-unwell']:
            parts.append('End immediately for care; staff handles the check and assisted exit.')
        else: parts.append('Begin an early goodbye; settle separately and let the departure finish.')
    else: parts.append('Continue the evening.')
    if effects.get('service')=='water': parts.append('Request water if none has been requested.')
    elif effects.get('service')=='help': parts.append('Staff help remains part of the scene context.')
    return ' '.join(parts)

def reaction_text(choice):
    reaction=choice.get('reaction')
    if isinstance(reaction,dict): return 'Reaction: '+', '.join(f'{name} {reaction[style]}' for name,style in [('Mira','playful'),('Jules','dry'),('Dev','direct')])+'.'
    if reaction: return 'Reaction: '+reaction+'.'
    return ''

def practical_choice(scenario_id, choice_id, final=False):
    if scenario_id=='feeling-unwell' and final:
        return 'Hold stays active; resume dinner after the date returns.' if choice_id=='slow-dinner' else 'Finalize the agenda, settle separately and end for care.'
    if scenario_id=='wine-spill' and final:
        return 'Stain cleaned; cloth used; glasses temporarily cleared; date takes a cleanup break; kitchen held until resumed.' if choice_id=='fresh-start' else 'Stain cleaned; cloth used; glasses stay; dinner continues at the table.'
    if scenario_id=='oversized-order':
        if choice_id=='help': return 'Cancel the two pending dishes if they are still cooking; their charge becomes zero.'
        if final: return 'One served extra stays to share; remaining served extras are boxed; pending extras are cancelled.' if choice_id=='share-chosen' else 'All served extras are boxed; pending extras are cancelled; your own meal stays separate.'
        return 'Pending extras keep cooking and become served and billable after 12 scene seconds.'
    if scenario_id=='unwelcome-comment' and final:
        return 'Move the whole table, actors, prop targets and collider by 3.85 world units; suppress the later noise incident; 120 seconds of quiet.' if choice_id=='move-away' else 'Remain at the current table; staff handles the diner; 120 seconds of quiet.'
    if scenario_id in ['allergic-reaction','too-many-drinks'] and final:
        return ('Record the requested contact; ' if choice_id in ['contact-person','trusted-person'] else '')+'finalize the agenda and settle this pair once; the other Double pair can continue.'
    return ''

for s in DATA['scenarios']:
    page(s['title'],'story_'+s['id'].replace('-','_'))
    p(s['setup'],size=11,after=7)
    p(f"Two decision beats   |   {s['firstChoiceCount']+s['followChoiceCount']} choice records   |   {s['histories']} complete histories   |   Two terminal options",size=9.5,after=7,color='4F5963')
    heading('Opening response',2)
    for i,choice in enumerate(s['choices']):
        details=choice['fact']
        reaction=reaction_text(choice)
        if reaction: details+=' '+reaction
        follow=FOLLOW_NOTES.get((s['id'],choice['id']))
        if follow: details+=' Next: '+follow
        if choice.get('effects'): details+=' '+effects_text(choice['effects'],s['id']).replace('Continue the evening. ','')
        practical=practical_choice(s['id'],choice['id'])
        if practical: details+=' Physical result: '+practical
        if choice.get('followLabels'):
            details+=' Follow-up wording: '+' / '.join('“'+label+'”' for label in choice['followLabels'].values())+'.'
        tree(choice['label'],details,last=i==len(s['choices'])-1)
    heading('All opening branches reach follow through',2)
    p(s['follow'],after=6,size=10)
    for i,choice in enumerate(s['endings']):
        details=choice['fact']+' '+effects_text(choice.get('effects',{}),s['id'])
        if s['id']=='questioning-attraction': details+=' The first decision has already closed romance.'
        practical=practical_choice(s['id'],choice['id'],True)
        if practical: details+=' Physical result: '+practical
        tree(choice['label'],details,last=i==len(s['endings'])-1)
    specials=[]
    if s['id'] in ['feeling-unwell','too-many-drinks']: specials.append('The first decision requests water if none has been requested; delivery follows the normal 12-second care timer.')
    if s['id']=='feeling-unwell': specials.append('Opening holds the kitchen and sends the date away. Six seconds starts their return; follow-through and date dialogue wait until they reach the seat. Resume is explicit; a 45-second held-time fallback applies only after resolution and return.')
    if s['id']=='wine-spill': specials.append('The wet stain and ready cloth are visible from activation. Both endings clean the stain and lower the glass. Fresh start also removes the glasses during a real cleanup break; resume after the return. Separate from the three-wipe water incident.')
    if s['id']=='oversized-order': specials.append('Four extras are tracked: two served, two pending. Pending/cancelled dishes cost zero; served/shared/boxed dishes remain billed. Waiting 12 seconds can increase the bill before packing. The receipt and food/box meshes read the same ledger.')
    if s['id']=='allergic-reaction': specials.append('Eli has already called emergency help in the opening; neither response delays that call. Both final choices end dinner for care.')
    if s['id']=='too-many-drinks': specials.append('Both final choices end the date for care rather than making intoxication a romance branch.')
    if s['id']=='questioning-attraction': specials.append('Romance closes on either first choice, before the final friendship or goodbye decision.')
    if specials: p(' '.join(specials),size=9.5,after=4,before=3)
    p('Each accepted choice records its attributed fact as a table fact that the date reads back; it is not written into the notebook the model rewrites. Resolution keeps both facts as one shared moment. Choice commitment is immediate; agenda clues and personal refusals still require completed delivery to count as heard.',size=9.2,after=0,before=4,color='4F5963')
    source(f"src/restaurant/scenarios.ts  {s['id']}  |  server/restaurant/scenario.ts applyScenarioToView  |  Mode ownership and scheduling are in the mode map.")

page('Physical interruptions','physical')
p('These three incidents are separate from the single seeded story. Each can resolve once. They are independent checks against scene time and course state, spaced by calm gaps. A fast dinner, care hold or early departure may prevent later eligibility.',size=11)
tree('Wrong order','Checked at main delivery, before bites; requires a clear table and no previous wrong-order incident or resolution.')
tree('Spilled water','Sixty scene seconds after the main is served, or the next calm moment after that, as long as dessert has not reached the table. A resolved wrong order is not required.')
tree('Disruptive diner','Thirty scene seconds after dessert is served, while it is still on the table and the table has not moved to the quieter location. A resolved spill is not required.',last=True)
heading('Shared physical gates',2)
p('Seated; date present; kitchen not held; no requested or settled bill; no farewell, departure, active story or current incident. Quiet periods must have expired and more than 25 scene seconds must separate interruptions. Double Date also keeps the active table clear and respects active pairs’ quiet windows.')
heading('What can happen in one evening',2)
tree('Delivery while the table is clear','The wrong dish can be noticed immediately and recovered before eating.')
tree('Keep the evening active through later timers','Water and noise each remain eligible independently once their own gates are met.')
tree('Move to the quieter table or finish early','The quiet location suppresses the later noise; the check arriving or a departure closes interruption eligibility.',last=True)
p('A provider-content redirect may introduce a wrong order only on a served, untouched plate with no earlier wrong-order resolution and a clear table. Otherwise it uses a brief waiter check-in. A provider refusal is not itself a personal-boundary strike.')
source('server/restaurant/evening.ts startIncident, redirectConversation and step; server/double-date/scene.ts captureIncident, shareIncident and step.')

page('Wrong order')
p('The waiter has brought a different main. The controller swaps the served dish to an alternative from the menu; the original order remains recorded.')
tree('Check the order ticket','Required first. Progress becomes one; a moment records the original order and the plate actually served.')
tree('Ask for the right dish','Available after checking the ticket. Restore the original ordered dish; record the polite return and resolution.',level=1)
tree('Keep the surprise','Available after checking the ticket. Keep the alternative served dish; record that you accepted the unexpected meal.',level=1,last=True)
heading('Consequences and callbacks',2)
p('Two meaningful terminal responses. Both clear the incident, start a new 25-second calm interval, and keep a factual resolution and shared moment. The date and waiter have authored returned/kept callbacks. Neither choice grants agenda points or purchases affection.')
p('In Double Date one pair owns the physical meal mistake while both clients see the shared incident. Either seated friend can perform recovery. If the owning date leaves, the remaining diner’s meal is left unchanged: Eli clears the departed pair’s unexpected plate and records that fact instead of making the remaining player return food they never received.')
heading('Recovery and timing',2)
p('Eli does not clear or serve while the incident stands, and the prompt line shows only its handling until it is resolved. There is no authored failure timeout. The mistake is revealed before eating, and an eaten dish cannot be replaced by a redirect. Keeping the replacement preserves the original ordered price and shows the actual dish on the receipt.')
source('server/restaurant/evening.ts inspect-ticket, return-order, keep-order and startIncident; src/restaurant/EveningInterface.ts prompt line; server/double-date/scene.ts incident ownership transfer.')

page('Spilled water')
p('A passing tray clips a water glass. This is a physical recovery sequence, not the separate seeded wine-on-a-sleeve story.')
tree('Wipe with the napkin','Three accepted wipes are required. Wipes must be at least 100 ms apart.')
tree('First wipe','Progress one; a comfortable date offers an authored help response.',level=1)
tree('Second wipe','Progress two; continue drying the table.',level=1)
tree('Third wipe','Progress three; the spill is dry and the date asks to set the glass upright.',level=1,last=True)
tree('Set the glass upright','Only after the third wipe. Lower the glass, clear the incident, keep the teamwork moment and start a calm gap.',last=True)
heading('Consequences and callbacks',2)
p('One completed physical recovery route, with four successful actions. Extra wipes after progress three do not create another route. Trying to steady the glass too early is rejected without ending the date. The date and waiter have authored recovery lines.')
p('A curious date becomes comfortable only if agenda confidence has already been earned. Wiping alone does not manufacture trust. Either seated Double Date friend can help recover the shared spill; the per-pair ownership logic keeps the table coherent if a date departs.')
source('server/restaurant/evening.ts wipe and steady-glass; src/restaurant/story.ts spill callbacks; server/double-date/scene.ts recovery forwarding.')

page('Disruptive diner')
p('The nearby diner takes a loud speakerphone call. This physical interruption is different from the seeded prejudiced-comment encounter.')
tree('Ask the waiter for a little quiet','Eli intervenes; the diner takes the call outside. Record the calm response and clear the interruption.')
tree('Let it pass. Back to us.','Return attention to your own evening. Record that choice and clear the interruption.')
tree('Acknowledge the awkward moment','The underlying apologize action can also resolve this incident with a cooling-down account and run the ordinary repair controller.',last=True)
heading('Reachability matters',2)
p('The prompt line exposes the first two choices. The apologize resolution exists in the server action set, but the prompt line does not present it as a third chip. Treat this as two normally presented endings plus one accepted recovery action, rather than three equal visible choices.')
heading('Consequences and callbacks',2)
p('All accepted resolutions clear the incident and retain a factual moment. Asking for quiet and letting it pass have different authored date/diner responses. Apology records the calmer account and can repair a prior social state; it does not override a leaving decision or instantly earn agenda confidence. There is no timed failure or automatic romantic reward.')
source('server/restaurant/evening.ts ask-quiet, let-it-go and apologize; src/restaurant/EveningInterface.ts prompt line; src/restaurant/story.ts diner callbacks.')

page('Activities and small gestures','activities')
heading('Shared activities',2)
tree('Share dessert','Eli offers dessert as he clears the main. Choose one of three desserts or skip it; if nobody chooses within 40 scene seconds the date picks their favourite, or declines when guarded or hurt. One plate, two spoons: the first spoonful (or 25 seconds together) records the shared moment, and the plate finishes 75 seconds after service or 40 seconds after two spoonfuls.',last=True)
p('Dessert decisions remain per pair in Double Date; Eli brings one check once every active pair has finished or declined dessert and nothing is being mopped up.',size=10,after=4)
heading('Care choices',2)
tree('Offer a taste','Once, while the meal is served. Acceptance requires an unguarded/unhurt stance and either the date’s preferred main or sufficient openness. Presets other than Jules can accept a nonpreferred dish; Blind uses openness at least 50. Acceptance records tasting; a refusal stands without a penalty.')
tree('Make a toast','One choice among “To tonight”, “To honesty”, “To friendship” and “To a little mischief”. Requires an order and no requested bill. Records a shared toast and raises the glass; no romance score is awarded.')
tree('Check in','Once after ordering and before the bill. Guarded/hurt dates, Jules, or a Blind date with sociability below 40 choose a slower pace and 45 quiet seconds. Otherwise they continue; earned confidence changes the wording.')
tree('Ask for fresh water','First request or a refill when the served carafe is empty and your glass is below full. Delivery after 12 scene seconds restores the glass and shared carafe.',last=True)
source('server/restaurant/evening.ts care actions and dessert pacing; src/restaurant/evening.ts EVENING_PACE; server/double-date/scene.ts shared check. Gifts and payment never determine attraction.')

page('Table objects and their state')
p('The new tabletop layer contains ten deterministic actions. It changes physical state without issuing a model request, writing an invented memory, or awarding relationship points. Only relevant food and water facts enter future conversation context.')
table(['Object','Action and state change','Limits and ownership'],[
    ['Water glass','Sip one of four fill units; raise briefly, then lower after 1.2 scene seconds.','Own glass; empty glass cannot be sipped.'],
    ['Carafe','Pour the smaller of missing glass capacity and remaining shared water.','Shared capacity six; a full glass or empty carafe blocks pouring.'],
    ['Bread basket','Take one of four shared pieces; increment own pieces eaten.','Shared stock; no automatic relationship score.'],
    ['Salt and pepper','Season the current meal once with each.','Own served meal, before three bites. A changed dish resets seasoning.'],
    ['Cutlery','Toggle between straight and crossed.','Own setting; purely physical.'],
    ['Napkin','Fold or unfold; drawing unfolds it.','Own setting; does not erase a saved drawing.'],
    ['Table lamp','Cycle full light → low light → off → full.','Shared table state.'],
    ['Vase','Turn one of twelve steps.','Shared table state.'],
    ['Plate','Turn one of twelve steps.','Own setting; food’s direct interaction keeps its bite behavior.'],
],[1.25,4.45,4.02],small=10)
p('All actions require a seated, active date without a farewell, active story or physical incident. A care hold or absent date blocks food and course use. Double Date also blocks tabletop actions during a shared interruption; a completed pair cannot keep changing its own date’s table state.')
source('src/restaurant/tabletop.ts; server/restaurant/tabletop.ts; server/double-date/scene.ts tabletop command gate.')

page('Understanding and the sixteen agendas','agenda')
p('Every date starts skeptical. The agenda is what they want from this particular evening, not a new NPC biography, trivia quiz, or guarantee of attraction. One of sixteen goals is selected privately from the session and character seed; Blind uses its reproducible seed.')
tree('A meaningful clue is actually heard','A generated but interrupted line is not enough. The clue must be an exact substring of the date’s current line, with a completed delivery receipt.')
tree('Notice the relevant preference','One previously heard distinct clue, current-turn evidence and the next valid milestone → 30 points.')
tree('Understand why it matters','Two distinct previously heard specifics and fresh current-turn evidence → 35 more points, total 65.')
tree('Make room through an actual present response','The next ordered milestone, two heard specifics and fresh evidence → 35 more points, total 100 and earned confidence.',last=True)
heading('What does not count',2)
p('Flattery, copied or reused evidence, trivia, dishonest agreement, a promise about the future, pressure, or asking for points. Evidence must quote the current human turn exactly. A clue disclosed in the current reply cannot retroactively make that human turn ready for credit. Honest incompatibility can still show full understanding.')
heading('What the score changes',2)
p('Earned confidence can permit a curious date to become comfortable when a kind, curious or humorous response lands. It contributes to some farewell outcomes and is a prerequisite for earned Dolphin routing. The score never purchases attraction, reverses a refusal or reopens a date that has left.')
p('Disregard removes the respected milestone, returning a completed rubric from 100 to 65. A repair may permit a conversation to continue; the missing follow-through must be earned again. Goal and reflection are normally revealed only when the ending is finalized.')
source('server/restaurant/agendas.ts; server/restaurant/skepticism.ts; server/restaurant/evening.ts social and farewell logic.')

for start in range(0,16,4):
    page('Agenda goals and evidence' + (' continued' if start else ''))
    for agenda in DATA['agendas'][start:start+4]:
        heading(agenda['goal'].rstrip('.'),2)
        p('Natural clue: '+agenda['hint'],after=3)
        tree('Understand',agenda['understood'],level=0)
        tree('Respect through a present response',agenda['respected'],level=0,last=True)
    source('Private rubric bank in server/restaurant/agendas.ts. “Notice” always requires a relevant preference from the actual evening. The three milestones remain ordered for every goal.')

page('Boundaries and recovery','boundaries')
p('The controller separates a provider-content limit from a date’s personal refusal. All characters are fictional adults. Non-graphic flirting or innuendo alone is not disregard, and a first refusal does not retrospectively punish the preceding turn.')
tree('The date states a specific refusal','It must appear in the actual current date line. No disregard penalty yet.')
tree('The responsible human hears the completed refusal','Only then is that topic active for this person and this date. Interrupted or unheard warnings do not establish the boundary.',level=1)
tree('Respect it or change the subject','Continue the evening without a repeat penalty.',level=2)
tree('Acknowledge a previously disregarded boundary','Current-turn repair evidence can lower that topic’s disregard count and run repair. Unrelated kindness does not erase it.',level=2)
tree('Disregard the same delivered topic once','Server count one; guarded stance, loss of respected credit, chemistry access revoked.',level=2)
tree('Disregard the same topic again','Server count two permits departure only when the date also asks to leave. The departure is final.',level=3,last=True)
heading('Double Date attribution',2)
p('Refusals are per date, listener and topic. A friend’s words cannot be charged to the other human. The date may react to either person; agenda credit remains with the paired human, while each listener’s delivery is tracked separately. A departed date is offstage and cannot keep speaking or have its outcome reopened.')
heading('Friend conversation and inclusion',2)
p('Three observable public turns directed only to the friend make available dates annoyed and guarded. Addressing the table resets both exclusion counters; addressing a particular date resets that date’s counter. A sincere repair can return them to curious, or comfortable if confidence has already been earned. Silence, menus, microphone denial, lag and reconnect time do not count as neglect.')
source('server/restaurant/boundaries.ts and EveningDirector.social; server/double-date/conversation.ts excluded counters and speaker attribution.')

page('Earned Dolphin access','chemistry')
p('This is an eligibility and provider-routing progression. It is not an additional authored story and does not promise a particular sexual response or remove the character’s boundaries.')
tree('Start with the configured conversation route','In the Haiku and earned-Dolphin setup, a new date cannot start on Dolphin. Ordinary dialogue and physical choices remain available.')
tree('Earn confidence in the agenda','Hear at least two distinct specifics and earn noticed, understood and respected. The date cannot be guarded, hurt, leaving, finished or friendship-only.')
tree('Two distinct reciprocal flirt moments are completed','Each needs a different generation, fresh human wording of at least three words, a distinct date line tagged flirtatious, and a completed receipt to the paired listener. Refusals and repeated pressure do not count.')
tree('Check the topic and configured route on each turn','After mutual chemistry, automatic Haiku uses the configured earned provider only for adult-topic dialogue, judged locally from the current text and recent delivered turns. Ordinary talk stays on Haiku. Eligibility does not configure a missing provider.',last=True)
heading('Loss and recovery',2)
tree('An interruption','Discard unfinished candidate delivery; already earned reciprocal moments remain.')
tree('Accepted disregard','Remove earned chemistry moments. Repair and renewed confidence need two fresh reciprocal moments.')
tree('Friendship closure or an ending','Eligibility becomes false immediately. Paying, winning or high understanding cannot reopen attraction.',last=True)
p('Double Date evaluates the speaking human’s pair independently. One couple earning access does not unlock the other couple. One completed human turn still produces one shared model request, rather than a background request per cast member.')
p('Explicit Dolphin selection remains chemistry-gated. A deliberate Horde choice is available immediately when configured and overrides automatic routing; reset returns to automatic selection. Server configuration can instead use Horde for the entire evening or as the earned alternative. Provider choice does not unlock romance, erase boundaries or add an authored encounter.',size=10,after=4)
source('server/restaurant/chemistry.ts; server/restaurant/skepticism.ts; server/restaurant/index.ts modelFor; server/double-date/conversation.ts effectiveModel selection.')

page('Farewell and endings','endings')
p('For the ordinary farewell, let Eli clear the main, choose or skip dessert (or let the date decide), wait for Eli to leave the check, and settle it by splitting, treating or paying separately. Then stand and walk within the entrance radius. The player can ask to meet again, offer friendship, or say goodbye.')
tree('Player says goodbye OR the date remains guarded or hurt','Quiet goodbye. This takes precedence over the warmer branches below.')
tree('Romance was closed OR the player chooses friendship','New friend, unless the earlier quiet-goodbye condition applied.')
tree('Ask to meet again after an honestly repaired hurt','Earned confidence plus repaired=true and wasHurt=true → second chance.')
tree('Ask to meet again with earned confidence and comfortable stance','At least one dialogue turn OR a shared toast, taste or dessert → another evening.')
tree('Any other ordinary farewell','New friend. An optimistic request alone does not manufacture romantic interest.',last=True)
heading('Other ways to finish',2)
tree('Choose End date or a valid early exit','Early exit. If food was ordered, settle separately rather than silently avoiding the check.')
tree('A seeded story chooses an early finish','Early-exit kind with a story-specific title and facts. Medical/unwell paths end immediately with assisted care; other mismatch paths begin a departure.')
tree('Repeated delivered boundary disregard and a request to leave','Walked away. No subsequent kindness, payment, conversation or table action reverses the departure.',last=True)
p('After the farewell is heard or 30 scene seconds pass, the evening can finish when the character reaches the doorway. After 45 seconds, the departure ends through a fallback. Double pairs can finish independently; one human may remain as a wingman while the other date continues. The shared Double bill checks every active pair is seated, finished with dinner and clear of interruptions before applying a settlement.')
source('server/restaurant/evening.ts farewell, beginEnding, earlyExit and step; server/restaurant/scenario.ts assisted exits; server/double-date/scene.ts wingman and room completion.')

page('Characters and Blind Date variation','characters')
for date in DATA['dates']:
    heading(f"{date['name']} {date['age']}",2)
    p(date['personality'],after=4)
    p('Preferred main: '+date['story']['preferredMain']+'. Preferred dessert: '+next(d['name'] for d in DATA['desserts'] if d['id']==date['story']['preferredDessert'])+'.',size=10,after=4)
    p('Private thread: '+date['story']['vulnerability'],size=10,after=7)
p('All three can receive any of the sixteen evening agendas. The biography and agenda shape different things: a fixed life beyond dinner versus what this person wants from tonight. Neither specifies the required romantic ending.')
source('src/restaurant/content.ts and story.ts; server/restaurant/agendas.ts. The adult presets are three biographies, not sixteen agenda variants counted as sixteen new characters.')

page('Blind Date ingredients')
p('A seed reproduces five 0–100 traits, appearance, occupation with unfinished ambition, hobby, history, humor, value, dislike, flirting style, preferred main and dessert. Reusing Mira, Jules or Dev’s appearance does not reuse that preset’s job or family story.')
table(['Occupation ingredient','Unfinished ambition paired with that occupation'],[[job[0],job[1]] for job in DATA['blindBanks']['jobs']],[4.1,5.62],small=9.5)
p('Other banks contain twelve hobbies and six each of personal histories, humor styles, values, dislikes and flirting styles. These ingredients are chosen by one seeded generator; multiplying every bank size would not establish a number of independent authored encounters or unique reachable people.')
p('Seeded story delivery uses directness above 65 for direct, otherwise sociability above 55 for playful, otherwise dry. Opening lines and other cues have their own trait conditions. Food preferences are tastes, not invented allergies; the serious-allergy story supplies its own explicit event.')
source('src/restaurant/blind-date.ts createBlindDate; server/restaurant/scenario.ts scenarioStyle; server/restaurant/agendas.ts seed selection.')

page('Source coverage','sources')
p('The atlas was derived from the repository on 9 November 2026. Every one of the 58 story histories was executed through the actual scenario choice functions in all three delivery styles, for 174 deterministic checks. Those checks made no provider calls. The medical-versus-boundary comparison used the real DoubleTableScene controller.')
table(['Source','Coverage'],[
    ['src/restaurant/scenarios.ts','All eleven seeded stories, exact player choice text, reactions, follow-through overrides, state effects and complete histories.'],
    ['src/restaurant/scenario-types.ts','Story phases, decisions, effects and care state.'],
    ['src/restaurant/scenario-care.ts; server/restaurant/scenario-effects.ts','Kitchen hold and resume, physical return, clean-up, quiet-table choice, extra-food statuses, cooking deadline and itemized charges.'],
    ['server/restaurant/evening.ts and scenario.ts','Course gates, care gestures, three physical incidents, timing, table facts, scoring interactions and endings.'],
    ['server/double-date/scenarios.ts and scene.ts','Shared target, either-friend choices, one check for the table, incident recovery and independent pair endings.'],
    ['server/restaurant/agendas.ts and skepticism.ts','Sixteen private goals, exact evidence criteria, heard-clue readiness, milestones and confidence.'],
    ['server/restaurant/boundaries.ts and chemistry.ts','Delivery-dependent refusals, disregard, repair, reciprocal flirt receipts and eligibility.'],
    ['server/double-date/conversation.ts, table-note.ts and server/restaurant/index.ts, turn-note.ts','Friend-only attention, shared turn ownership, earned provider routing and what the date model reads.'],
    ['src/restaurant/content.ts, story.ts and blind-date.ts','Adult biographies, preset preferences, '+str(DATA['counts']['storyCueKeys'])+' authored cue keys and seeded personality ingredients.'],
    ['src/restaurant/evening.ts; src/restaurant/tabletop.ts; server/restaurant/tabletop.ts','Evening pacing clocks, finite table supplies and ten deterministic prop actions.'],
],[4.5,5.22],small=9.5)
heading('Editable structure',2)
p('The trees, tables, labels and results are native Word content. Heading styles provide navigation; the encounter index links to each story. Per-history data records opening, first-choice and completed mechanical state, plus the oversized-order late-cooking variation. Reproducible helpers support later updates. No source code is embedded as an image.')
source('Analysis data: docs/artifacts/encounter-atlas-data.json. Helpers: scripts/analyze-encounter-atlas.mjs and scripts/verify-encounter-atlas-audit.mjs. Document builder: scripts/build_encounter_atlas.py.')

OUT.mkdir(parents=True,exist_ok=True)
destination=OUT/'Restaurant Encounter Atlas.docx'
DOC.save(destination)
print(json.dumps({'output':str(destination),'intendedPages':1+len(page_titles),'storyCount':len(DATA['scenarios']),'histories':DATA['counts']['decisionHistories'],'wordCount':sum(len(p.text.split()) for p in DOC.paragraphs)},indent=2))

"""Illustrations de la mise en place (wordpress/carte-blanche/setup/img), rendues avec le moteur.
Usage, depuis services/print-engine : .venv/bin/python ../../wordpress/scripts/illustrations.py"""
from PIL import Image, ImageDraw, ImageFilter, ImageOps
from flux_print.design import backs, classic
OUT='../../wordpress/carte-blanche/setup/img/'
BG=(243,239,231,255)
def back(mid, title='', sub='', w=440):
    m=backs.models()[mid]
    return backs.render(backs.fill(mid, backs.fields(mid, m['bg'], m['ink'], title, sub)), w)
def court(code, w=440): return classic.court(code, w).convert('RGB')
def rounded(img, r):
    img=img.convert('RGBA'); mask=Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0,0,img.width-1,img.height-1], r, fill=255); img.putalpha(mask); return img
def paste_card(canvas, card, center, angle=0):
    card=ImageOps.expand(rounded(card, int(card.width*0.045)), 50, fill=(0,0,0,0))
    if angle: card=card.rotate(angle, expand=True, resample=Image.BICUBIC)
    sh=Image.new('RGBA', card.size, (40,30,20,0)); sh.putalpha(card.getchannel('A').point(lambda a: int(a*0.30)))
    sh=sh.filter(ImageFilter.GaussianBlur(16))
    x,y=center[0]-card.width//2, center[1]-card.height//2
    canvas.alpha_composite(sh,(x+8,y+16)); canvas.alpha_composite(card,(x,y))
def save(img,name): img.convert('RGB').save(OUT+name+'.jpg',quality=82,optimize=True,progressive=True)
H=Image.new('RGBA',(1400,1000),BG)
for i,(c,a) in enumerate([(back('rayures','Anniversaire','Léa · 30 ans'),-14),(back('art-deco','J & M','12 · 06 · 2027'),-7),(court('HK'),0),(back('classique','Famille Martin'),7),(court('SQ'),14)]):
    paste_card(H,c,(300+i*200, 500+abs(i-2)*28),-a)
save(H,'jeu-de-cartes-personnalise')
D=Image.new('RGBA',(1600,760),BG)
for i,(mid,t,s) in enumerate([('classique','Famille Martin',''),('art-deco','J & M','12 · 06 · 2027'),('elegant','Mariage','Chloé & Hugo'),('monogramme','AB','')]):
    paste_card(D, back(mid,t,s,330),(230+i*380,380))
save(D,'dos-de-cartes-personnalises')
F=Image.new('RGBA',(1400,760),BG)
for i,c in enumerate(['HK','HQ','HJ']): paste_card(F, court(c,370),(300+i*400,380))
save(F,'figures-roi-dame-valet')
E=Image.new('RGBA',(1400,760),BG)
for i,(mid,t,s) in enumerate([('elegant','Votre marque','Depuis 1987'),('classique','Votre logo',''),('rayures','Séminaire','Édition 2027')]):
    paste_card(E, back(mid,t,s,370),(300+i*400,380))
save(E,'jeu-de-cartes-entreprise')
for name,items in [('jeu-54-cartes-personnalise',[(back('classique','Famille Martin'),-8),(court('HK'),6)]),('jeu-de-belote-personnalise',[(back('art-deco','Belote','Chez Paulo'),-8),(court('SJ'),6)])]:
    P=Image.new('RGBA',(1200,1200),BG)
    for i,(c,a) in enumerate(items): paste_card(P,c,(420+i*360,600+i*20),-a)
    save(P,name)

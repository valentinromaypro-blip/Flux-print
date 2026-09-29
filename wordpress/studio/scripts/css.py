"""Reprend les styles du studio du site (apps/site/src/app/globals.css) en les limitant au bloc
#cb-studio (.cb-studio-root), pour ne pas toucher au thème WordPress. Usage : python3 scripts/css.py"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
css = re.sub(r"/\*.*?\*/", "", (HERE / "../../apps/site/src/app/globals.css").read_text(), flags=re.S)
SKIP = (".bo-", ".stage-box", ".admin", ".side", ".kpi", ".todo", ".flow", ".chart", ".lot", ".order-page", ".sheet")


def blocks(s):
    i, out = 0, []
    while (j := s.find("{", i)) >= 0:
        depth, k = 1, j + 1
        while depth:
            depth += {"{": 1, "}": -1}.get(s[k], 0)
            k += 1
        out.append((s[i:j].strip(), s[j + 1:k - 1]))
        i = k
    return out


def scoped(sel):
    parts = [p.strip() for p in sel.split(",")]
    if any(p in (":root",) or p.startswith(("html", "body")) for p in parts):
        return None
    return ", ".join(".cb-studio-root " + p for p in parts)


out = []
for sel, body in blocks(css):
    if sel.startswith(("@media", "@supports")):
        inner = [f"{p} {{{b}}}" for s, b in blocks(body) if not any(x in s for x in SKIP) and (p := scoped(s))]
        if inner:
            out.append(sel + " { " + "\n".join(inner) + " }")
    elif sel.startswith("@keyframes"):
        out.append(sel.replace("@keyframes ", "@keyframes cb-") + " {" + body + "}")
    elif sel.startswith("@"):
        continue
    elif sel == ":root":
        out.append(".cb-studio-root {" + body + "}")
    elif not any(x in sel for x in SKIP) and (p := scoped(sel)):
        out.append(p + " {" + body + "}")
s = "\n".join(out)
for name in re.findall(r"@keyframes cb-([\w-]+)", s):
    s = re.sub(r"(animation[^;]*?)\b" + name + r"\b", r"\1cb-" + name, s)
s = s.replace(".cb-studio-root .container", ".cb-studio-root .cb-container")
fonts = "".join(f'@font-face {{ font-family: "{f}"; src: url("../backs/fonts/{n}.ttf") format("truetype"); font-display: block; }}\n'
                for f, n in [("CB Serif", "cb-serif"), ("CB Display", "cb-display"), ("CB Sans", "cb-sans")])
(HERE / "src/studio.css").write_text("/* Généré par scripts/css.py depuis le site : ne pas modifier ici (voir src/wp.css). */\n" + fonts + s + "\n")

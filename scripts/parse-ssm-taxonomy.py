"""Parse SSM's published taxonomy (SSMxT 2022 v1.0) into one JSON catalogue.

Usage:
    python3 scripts/parse-ssm-taxonomy.py <unzipped SSMxT_2022v1.0 dir> <out catalogue.json>

The package is a free download from SSM's MBRS page (SSMxT_2022v1.zip, ~6 MB);
it is not vendored in the repo. The catalogue carries every element (type,
period, abstract), the English labels from the core and entry-point label
files, the presentation tree per role, and the calculation arcs with weights —
enough for gen-mbrs-template.py to add slots the donor filings never used.
"""
import sys
import re, json, os, glob
from collections import defaultdict
import xml.etree.ElementTree as ET
ROOT=sys.argv[1].rstrip("/"); OUTP=sys.argv[2] if len(sys.argv)>2 else "catalogue.json"; MP=f"{ROOT}/rep/ssm/ca-2016/fs/mpers"
XL="{http://www.w3.org/1999/xlink}"; LK="{http://www.xbrl.org/2003/linkbase}"; XS="{http://www.w3.org/2001/XMLSchema}"; XB="{http://www.xbrl.org/2003/instance}"
NSP={"http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-mpers-cor":"ssmt-mpers","http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-cor":"ssmt",
     "http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-dei-core":"ssmt-dei","https://xbrl.ifrs.org/taxonomy/2022-03-24/ifrs-smes":"ifrs-smes",
     "https://xbrl.ifrs.org/taxonomy/2022-03-24/ifrs-full":"ifrs-full","http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-mfrs-cor":"ssmt-mfrs",
     "http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-dei-ee-mpers":"ssmt-dei-ee-mpers"}
# 1. elements from every schema: id -> qname, type, periodType, abstract
elems={}
for xsd in glob.glob(f"{ROOT}/**/*.xsd", recursive=True):
    try: t=ET.parse(xsd)
    except Exception: continue
    r=t.getroot(); tns=r.get("targetNamespace"); pfx=NSP.get(tns)
    if not pfx: continue
    for e in r.iter(f"{XS}element"):
        n=e.get("name"); i=e.get("id")
        if not n or not i: continue
        elems[i]={"q":f"{pfx}:{n}","type":(e.get("type") or "").split(":")[-1],"period":e.get(f"{XB}periodType"),"abstract":e.get("abstract")=="true",
                  "balance":e.get(f"{XB}balance")}
print("elements:",len(elems))
def qn(href):
    i=href.split("#")[-1]; return elems.get(i,{}).get("q", i)
# 2. labels (English) — the FS-MPERS entry-point file only carries overrides;
# the core names live in def/ic/*/lab_en_*.xml and def/ext/ifrs_for_smes/labels/.
labels=defaultdict(dict)
LABFILES=glob.glob(f"{ROOT}/def/**/lab_en*.xml",recursive=True)+glob.glob(f"{ROOT}/def/**/lab_*-en_*.xml",recursive=True)+[f"{MP}/lab_en-ssmt-fs-mpers_2022-12-31.xml"]
for lf in LABFILES:
    r=ET.parse(lf).getroot()
    for ext in r.iter(f"{LK}labelLink"):
        loc={l.get(f"{XL}label"):qn(l.get(f"{XL}href")) for l in ext.iter(f"{LK}loc")}
        lab={}
        for l in ext.iter(f"{LK}label"):
            lab.setdefault(l.get(f"{XL}label"),[]).append((l.get(f"{XL}role","").split("/")[-1], (l.text or "").strip()))
        for a in ext.iter(f"{LK}labelArc"):
            q=loc.get(a.get(f"{XL}from"))
            for role,txt in lab.get(a.get(f"{XL}to"),[]):
                labels[q].setdefault(role,txt)   # entry-point override loads last, core first: keep core unless absent
print("label files:",len(LABFILES),"| labelled concepts:",len(labels))
# 3. presentation trees per role
pres={}
for f in sorted(glob.glob(f"{MP}/pre_*role-*.xml")):
    role=re.search(r"role-(\w+)\.xml",f).group(1); t=ET.parse(f); r=t.getroot()
    for ext in r.iter(f"{LK}presentationLink"):
        loc={l.get(f"{XL}label"):qn(l.get(f"{XL}href")) for l in ext.iter(f"{LK}loc")}
        arcs=[(loc[a.get(f"{XL}from")],loc[a.get(f"{XL}to")],float(a.get("order","0"))) for a in ext.iter(f"{LK}presentationArc")]
        pres[role]=arcs
print("presentation roles:",len(pres), "| arcs:",sum(len(v) for v in pres.values()))
# 4. calculation arcs
cal={}
for f in sorted(glob.glob(f"{MP}/cal_*role-*.xml")):
    role=re.search(r"role-(\w+)\.xml",f).group(1); t=ET.parse(f); r=t.getroot()
    for ext in r.iter(f"{LK}calculationLink"):
        loc={l.get(f"{XL}label"):qn(l.get(f"{XL}href")) for l in ext.iter(f"{LK}loc")}
        cal[role]=[(loc[a.get(f"{XL}from")],loc[a.get(f"{XL}to")],float(a.get("weight","1")),float(a.get("order","0"))) for a in ext.iter(f"{LK}calculationArc")]
print("calculation roles:",len(cal), "| arcs:",sum(len(v) for v in cal.values()))
json.dump({"elems":{v["q"]:v for v in elems.values()},"labels":labels,"pres":pres,"cal":cal}, open(OUTP,"w"))
print("wrote",OUTP)

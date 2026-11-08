#!/usr/bin/env python3
"""Read-only, GitHub-only V1->V3 gate; never touches production infrastructure."""
import json, os, re, sys, urllib.request, urllib.error
REPO=os.getenv("GITHUB_REPOSITORY","Amer-ai-store/Mohammad-Ahmed-Ghannam")
ISSUE=92
MARKER="handoff/jawafa-v1-ready.json"
ALLOWED={"Android build and unit tests","Jawafa Unified Main Dashboard & Private Bridge QA","Jawafa V1 full-source and integration verification"}

def api(path, method="GET", obj=None):
    token=os.getenv("GH_TOKEN")
    if not token: raise RuntimeError("Missing GitHub token")
    data=json.dumps(obj).encode() if obj is not None else None
    req=urllib.request.Request("https://api.github.com/"+path, data=data, method=method,
      headers={"Authorization":"Bearer "+token, "Accept":"application/vnd.github+json",
               "X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=20) as res: return json.load(res)
    except urllib.error.HTTPError as exc:
        if exc.code==404 and method=="GET": return None
        raise RuntimeError("GitHub HTTP %s for %s"%(exc.code,path)) from exc

def validate(data):
    if not isinstance(data,dict) or data.get("status")!="READY_FOR_STAGE2":
        raise ValueError("explicit ready marker missing")
    sha=data.get("source_commit","")
    if not isinstance(sha,str) or not re.fullmatch("[0-9a-fA-F]{40}",sha):
        raise ValueError("invalid source_commit SHA")
    if data.get("source_repo")!=REPO: raise ValueError("wrong source repository")
    paths=data.get("source_paths")
    if not isinstance(paths,list) or not {"app","dashboard"}.issubset(set(map(str,paths))):
        raise ValueError("app and dashboard source paths required")
    if any(not isinstance(p,str) or not re.fullmatch("[A-Za-z0-9_./-]+",p)
           or ".." in p.split("/") or p.startswith("/") for p in paths):
        raise ValueError("invalid source path")
    runs=data.get("ci_evidence")
    if not isinstance(runs,list) or not 1<=len(runs)<=12:
        raise ValueError("at least one Actions run required")
    for run in runs:
        if not isinstance(run,dict) or run.get("workflow") not in ALLOWED or type(run.get("run_id")) is not int or run["run_id"]<1:
            raise ValueError("invalid CI evidence")
    if not isinstance(data.get("handoff_notes"),str) or not data["handoff_notes"].strip():
        raise ValueError("missing scope and known-blocker notes")
    return sha.lower(), paths, runs

def report(message):
    print(message)
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"],"a",encoding="utf-8") as f: f.write(message+"\n")

def verify(sha, paths, runs):
    commit=api("repos/%s/commits/%s"%(REPO,sha))
    if not commit or commit.get("sha","").lower()!=sha: raise ValueError("source commit not found")
    ancestor=api("repos/%s/compare/%s...main"%(REPO,sha))
    if not ancestor or ancestor.get("status") not in ("ahead","identical"):
        raise ValueError("source commit not contained in main")
    for path in paths:
        if api("repos/%s/contents/%s?ref=%s"%(REPO,path,sha)) is None:
            raise ValueError("source path missing at commit: "+path)
    for item in runs:
        run=api("repos/%s/actions/runs/%s"%(REPO,item["run_id"]))
        if not run or run.get("status")!="completed" or run.get("conclusion")!="success":
            raise ValueError("CI incomplete/failed: "+str(item["run_id"]))
        if run.get("name")!=item["workflow"] or run.get("head_sha","").lower()!=sha:
            raise ValueError("CI workflow/source SHA mismatch")
        if (run.get("repository") or {}).get("full_name","").lower()!=REPO.lower():
            raise ValueError("CI run from different repository")

def announce(sha,runs):
    key="<!-- JAWAFA_V1_STAGE2_GATE:%s -->"%sha
    for page in range(1,11):
        comments=api("repos/%s/issues/%d/comments?per_page=100&page=%s"%(REPO,ISSUE,page))
        if comments is None: raise RuntimeError("handoff issue unavailable")
        if any(key in (c.get("body") or "") for c in comments): return "already announced"
        if len(comments)<100: break
    lines="\n".join("- %s: https://github.com/%s/actions/runs/%s"%(x["workflow"],REPO,x["run_id"]) for x in runs)
    body=(key+"\n### V1 source handoff: TECHNICAL GATE PASS\n"
          "Source commit: \x60%s\x60\n\n%s\n\n"% (sha,lines)
          +"No financial/production/GATE-15 acceptance is implied. Stage-2 V3.0 code import, implementation and APK build require an authorized separate work session. No accounting data was changed.")
    api("repos/%s/issues/%d/comments"%(REPO,ISSUE),method="POST",obj={"body":body})
    return "announced to Issue #92"

def main():
    if "--self-test" in sys.argv:
        template={"status":"READY_FOR_STAGE2","source_repo":REPO,"source_commit":"a"*40,
                  "source_paths":["app","dashboard"],"ci_evidence":[{"workflow":"Android build and unit tests","run_id":1}],
                  "handoff_notes":"V1 source and known limitations."}
        assert validate(template)[0]=="a"*40
        for bad in [{"source_commit":"x"},{"status":"PENDING"},{"source_paths":["app"]},{"ci_evidence":[]}]:
            try: validate(dict(template,**bad))
            except ValueError: pass
            else: raise AssertionError("bad manifest accepted: "+str(bad))
        print("5/5 policy self-tests passed")
        return 0
    if not os.path.exists(MARKER):
        report("WAITING_FOR_V1: source handoff manifest not yet present. V3.0 and APK blocked.")
        return 0
    try:
        with open(MARKER,encoding="utf-8") as f: sha, paths, runs=validate(json.load(f))
        if "--preflight" in sys.argv:
            report("V1_PREFLIGHT_SCHEMA_PASS %s; source and CI evidence require main-branch verification."%sha)
            return 0
        verify(sha,paths,runs)
        report("V1_TECHNICAL_HANDOFF_PASS %s — %s"%(sha,announce(sha,runs)))
        return 0
    except (ValueError,RuntimeError,urllib.error.URLError,json.JSONDecodeError) as e:
        report("V1_HANDOFF_BLOCKED: %s; do not start stage 2 / APK."%e)
        return 1
if __name__=="__main__": sys.exit(main())

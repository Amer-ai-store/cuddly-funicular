#!/usr/bin/env python3
"""Read-only SHA-256 inventory check using the server's existing rclone OAuth.
No database writes, new credentials, Drive mutations or data exports.
"""
import csv
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from collections import Counter

RCLONE = r"C:\Export\JawafaDriveTransfer\rclone-portable\rclone-v1.75.2-windows-amd64\rclone.exe"
CONFIG = r"C:\Export\JawafaDriveTransfer\rclone-portable\jawafa.conf"
FOLDER = "1X9MuorGVaaAwolc25_MG4kgKQGPiWard"
REMOTE = "JawafaData:"
OUT = Path(r"C:\ProgramData\JawafaReadOnly\SecurityEvidence\DriveVerification")
ARGS = ["--config", CONFIG, "--drive-root-folder-id", FOLDER]

def rclone(*args):
    p = subprocess.run([RCLONE, *ARGS, *args], capture_output=True, timeout=300)
    if p.returncode:
        raise RuntimeError("rclone %s error, exit=%s" % (args[0], p.returncode))
    return p.stdout

def get_csv(path):
    return list(csv.DictReader(io.StringIO(rclone("cat", REMOTE + path).decode("utf-8-sig"))))

def main_check():
    inv = get_csv("inventory_tables.csv")
    man = get_csv("manifest_sha256.csv")
    objs = json.loads(rclone("lsjson", REMOTE + "data",
                             "--recursive", "--files-only", "--hash-type", "SHA-256",
                             "--fast-list"))
    issues = {}
    def issue(k, name):
        issues.setdefault(k, []).append(name)
    inv_names = [r["schema_name"].strip()+"."+r["table_name"].strip()+".csv" for r in inv]
    man_names = [r["file"].strip() for r in man]
    drive_names = [r["Path"] for r in objs]
    for label,names in [("inventory", inv_names),("manifest",man_names),("drive",drive_names)]:
        for name,num in Counter(names).items():
            if num > 1: issue(label+"_duplicates",name)
    for label,names in [
        ("missing_manifest", set(inv_names)-set(man_names)),
        ("extra_manifest", set(man_names)-set(inv_names)),
        ("missing_drive",set(inv_names)-set(drive_names)),
        ("extra_drive",set(drive_names)-set(inv_names)),
    ]:
        for n in sorted(names): issue(label,n)
    objects = {o["Path"]:o for o in objs}
    for record in man:
        name = record["file"].strip()
        if name not in objects: continue
        obj = objects[name]
        try:
            size = int(record["bytes"])
        except (TypeError, ValueError):
            issue("invalid_manifest_size",name)
            continue
        if int(obj["Size"]) != size: issue("size_mismatch",name)
        expected = record["sha256"].strip().lower()
        if not re.fullmatch(r"[0-9a-f]{64}",expected):
            issue("invalid_manifest_sha256",name)
            continue
        hashes = obj.get("Hashes") or {}
        actual = (hashes.get("sha256") or hashes.get("SHA-256") or "").lower()
        if not re.fullmatch(r"[0-9a-f]{64}",actual):
            issue("missing_drive_sha256",name)
        elif actual != expected:
            issue("sha256_mismatch",name)
    status = "VERIFIED" if not issues and len(inv)==len(man)==len(objs) else "FAILED"
    return {
        "status":status,
        "method":"Drive provider SHA-256 metadata vs private manifest",
        "inventory_count":len(inv),
        "manifest_count":len(man),
        "drive_file_count":len(objs),
        "manifest_bytes":sum(int(r["bytes"]) for r in man if str(r.get("bytes","")).isdigit()),
        "drive_bytes":sum(int(r.get("Size",0)) for r in objs),
        "issue_counts":{k:len(v) for k,v in sorted(issues.items())},
        "issues_private":issues,
    }

def main():
    start=dt.datetime.now(dt.timezone.utc)
    try:
        result=main_check()
    except Exception as e:
        result={"status":"ERROR","error_type":type(e).__name__,
                "error":str(e),"issue_counts":{}}
    result["checked_at_utc"]=start.isoformat()
    result["finished_at_utc"]=dt.datetime.now(dt.timezone.utc).isoformat()
    OUT.mkdir(parents=True,exist_ok=True)
    stamp=start.strftime("%Y%m%dT%H%M%SZ")
    p=OUT/("DriveVerification_"+stamp+".json")
    payload=json.dumps(result,ensure_ascii=False,indent=2)+"\n"
    p.write_text(payload,encoding="utf-8")
    latest=OUT/"latest.json.tmp"
    latest.write_text(payload,encoding="utf-8")
    os.replace(latest,OUT/"latest.json")
    pub={k:v for k,v in result.items() if k not in ("issues_private","error")}
    pub["report_path"]=str(p)
    pub["report_sha256"]=hashlib.sha256(payload.encode("utf-8")).hexdigest()
    print(json.dumps(pub,ensure_ascii=False),flush=True)
    return 0 if result["status"]=="VERIFIED" else 2

if __name__=="__main__":
    sys.exit(main())

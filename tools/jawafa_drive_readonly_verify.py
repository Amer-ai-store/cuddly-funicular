#!/usr/bin/env python3
"""Jawafa Drive inventory verifier. Run only on an authorized private host.
Requires pip install google-api-python-client google-auth
and GOOGLE_APPLICATION_CREDENTIALS pointing to a read-only service account JSON.
Share the Drive folder with that service account before running.
Never publish CSV contents, tokens or financial records to GitHub Pages.
"""
import csv, hashlib, io, json, os, sys
import google.auth
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

FOLDER = os.environ.get("JAWAFA_DRIVE_FOLDER", "1X9MuorGVaaAwolc25_MG4kgKQGPiWard")
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
def client():
    creds, _ = google.auth.default(scopes=SCOPES)
    return build("drive", "v3", credentials=creds, cache_discovery=False)
def children(api, folder):
    token = None
    while True:
        result = api.files().list(
            q="'%s' in parents and trashed = false" % folder,
            fields="nextPageToken,files(id,name,mimeType,size)",
            pageSize=1000, pageToken=token,
            supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
        yield from result.get("files", [])
        token = result.get("nextPageToken")
        if not token: break
def download(api, file_id):
    request = api.files().get_media(fileId=file_id, supportsAllDrives=True)
    out = io.BytesIO()
    downloader = MediaIoBaseDownload(out, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return out.getvalue()
def rows(data):
    return list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"))))
def main():
    api = client()
    root = {x["name"]: x for x in children(api, FOLDER)}
    inv = rows(download(api, root["inventory_tables.csv"]["id"]))
    manifest = rows(download(api, root["manifest_sha256.csv"]["id"]))
    expected = {x["schema_name"]+"."+x["table_name"]+".csv":x for x in inv}
    hashes = {x["file"]:x for x in manifest}
    data_folder = root["data"]["id"]
    files = {x["name"]:x for x in children(api, data_folder) if x["name"].lower().endswith(".csv")}
    failures = []
    for name, item in files.items():
        if name not in hashes:
            failures.append({"file":name,"error":"unexpected_file"})
            continue
        blob = download(api, item["id"])
        if hashlib.sha256(blob).hexdigest().lower() != hashes[name]["sha256"].lower():
            failures.append({"file":name,"error":"sha256_mismatch"})
    result = {
        "inventory_count":len(inv),"manifest_count":len(manifest),
        "drive_csv_count":len(files),
        "missing_from_drive":sorted(set(expected)-set(files)),
        "missing_from_manifest":sorted(set(expected)-set(hashes)),
        "extra_in_manifest":sorted(set(hashes)-set(expected)),
        "sha256_failures":failures,
        "verified":len(files)==len(expected)==len(hashes) and not failures
    }
    # Private host output only; do not copy this report into a public repository.
    print(json.dumps(result,ensure_ascii=False))
    if not result["verified"]: sys.exit(2)
if __name__=="__main__": main()

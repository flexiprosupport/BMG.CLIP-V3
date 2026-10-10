"""Schema-versioned, local SQLite queue. No cloud service or extra dependency."""
from __future__ import annotations
import json
import sqlite3
import threading
from .paths import ROOT_DIR

DB_PATH = ROOT_DIR / "data" / "processing.sqlite3"
_LOCK = threading.RLock()

def connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(DB_PATH), timeout=15)
    db.execute("PRAGMA busy_timeout=15000")
    return db

def initialize():
    with _LOCK, connection() as db:
        db.execute("PRAGMA journal_mode=WAL")
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version > 1:
            raise RuntimeError("Processing database requires a newer BMG.CLIP-V3 version.")
        db.execute("""CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, created REAL NOT NULL, status TEXT NOT NULL,
            batch_id TEXT, hidden INTEGER NOT NULL DEFAULT 0,
            request TEXT NOT NULL, snapshot TEXT NOT NULL)""")
        db.execute("CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status,created)")
        db.execute("CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, created REAL, title TEXT)")
        db.execute("CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT)")
        db.execute("PRAGMA user_version=1")

def save(job):
    snapshot = job.snapshot()
    with _LOCK, connection() as db:
        db.execute("""INSERT INTO jobs(id,created,status,batch_id,request,snapshot)
            VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            status=excluded.status,request=excluded.request,snapshot=excluded.snapshot""",
            (job.id,job.created_at,job.status,job.batch_id,
             job.req.model_dump_json(),json.dumps(snapshot,ensure_ascii=False)))

def load():
    with _LOCK, connection() as db:
        return [(id_,json.loads(req),json.loads(snap)) for id_,req,snap in
                db.execute("SELECT id,request,snapshot FROM jobs WHERE hidden=0 ORDER BY created")]

def save_batch(id_,created,title):
    with _LOCK, connection() as db:
        db.execute("INSERT INTO batches VALUES(?,?,?)",(id_,created,title))

def save_batch_jobs(id_,created,title,jobs):
    rows=[(j.id,j.created_at,j.status,id_,j.req.model_dump_json(),
           json.dumps(j.snapshot(),ensure_ascii=False)) for j in jobs]
    with _LOCK, connection() as db:
        db.execute("INSERT INTO batches VALUES(?,?,?)",(id_,created,title))
        db.executemany("INSERT INTO jobs(id,created,status,batch_id,request,snapshot) VALUES(?,?,?,?,?,?)",rows)

def batches():
    with _LOCK, connection() as db:
        return [{"id":i,"created_at":c,"title":t,"total":n,"completed":done or 0,"failed":failed or 0}
                for i,c,t,n,done,failed in db.execute("""SELECT b.id,b.created,b.title,
                    COUNT(j.id),SUM(j.status='done'),SUM(j.status='error')
                    FROM batches b LEFT JOIN jobs j ON j.batch_id=b.id
                    GROUP BY b.id ORDER BY b.created DESC""")]

def hide(id_):
    with _LOCK, connection() as db:
        db.execute("UPDATE jobs SET hidden=1 WHERE id=?",(id_,))

def preferences():
    with _LOCK, connection() as db:
        row = db.execute("SELECT value FROM preferences WHERE key='queue'").fetchone()
        return json.loads(row[0]) if row else {}

def save_preferences(value):
    with _LOCK, connection() as db:
        db.execute("INSERT OR REPLACE INTO preferences VALUES('queue',?)",(json.dumps(value),))


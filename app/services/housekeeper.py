import os
import glob
import fnmatch
import shutil
import sqlite3
import logging

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP_DIR = os.path.join(BASE_DIR, "app")
DB_PATH = os.path.join(APP_DIR, "metrics_live.db")


def _get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_housekeeper_tables():
    conn = _get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS cleanup_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern TEXT UNIQUE NOT NULL,
                rule_type TEXT NOT NULL,
                scope TEXT NOT NULL,
                description TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS protected_extensions (
                ext TEXT PRIMARY KEY,
                risk_level TEXT NOT NULL,
                consequence TEXT NOT NULL
            )
        """)

        cnt = next(iter(conn.execute("SELECT COUNT(*) FROM cleanup_rules").fetchone()))
        if cnt == 0:
            default_rules = (
                ("*.pyc", "extension", "app/*", "Bytecode compilado de Python"),
                ("*.pyo", "extension", "app/*", "Bytecode optimizado de Python"),
                ("*.bkp", "extension", "app/*", "Respaldos temporales de edición"),
                ("__pycache__", "folder", "app/*", "Caché de módulos Python"),
                ("metrics_live.db*", "file", "app", "Buffer temporal SQLite en vivo"),
                ("*.log", "extension", "/tmp", "Logs de ejecución en /tmp"),
            )
            conn.executemany(
                "INSERT OR IGNORE INTO cleanup_rules (pattern, rule_type, scope, description) VALUES (?, ?, ?, ?)",
                default_rules,
            )

        protected = (
            (".py", "ALTO", "Código fuente Backend Flask/Python. Borrarlo rompe rutas, APIs y servicios de la aplicación."),
            (".html", "ALTO", "Plantillas visuales Jinja2. Borrarlo deja la interfaz web en blanco o con error 500."),
            (".js", "ALTO", "Lógica interactiva del navegador (gráficas, menús, GSAP). El tablero dejará de responder."),
            (".css", "MEDIO", "Hojas de estilo visuales. La interfaz perderá todo el diseño oscuro y estructura."),
            (".env", "CRÍTICO", "Variables de entorno y llaves secretas de sesión."),
            (".sh", "MEDIO", "Scripts operativos de arranque o mantenimiento."),
            (".json", "MEDIO", "Archivos de configuración o diccionarios de datos."),
        )
        conn.executemany(
            "INSERT OR IGNORE INTO protected_extensions (ext, risk_level, consequence) VALUES (?, ?, ?)",
            protected,
        )
        conn.commit()
    finally:
        conn.close()


def get_rules_and_protected():
    init_housekeeper_tables()
    conn = _get_db()
    try:
        rules = list()
        for r in conn.execute("SELECT id, pattern, rule_type, scope, description FROM cleanup_rules ORDER BY id ASC").fetchall():
            it = iter(r)
            rules.append({"id": next(it), "pattern": next(it), "rule_type": next(it), "scope": next(it), "description": next(it)})
        prot = {}
        for r in conn.execute("SELECT ext, risk_level, consequence FROM protected_extensions").fetchall():
            it = iter(r)
            prot[next(it)] = {"risk_level": next(it), "consequence": next(it)}
        return {"ok": True, "rules": rules, "protected": prot}
    finally:
        conn.close()


def add_cleanup_rule(pattern, rule_type="extension", scope="app/*", description=""):
    init_housekeeper_tables()
    pat = str(pattern or "").strip()
    if not pat:
        return {"ok": False, "error": "El patrón no puede estar vacío."}
    if pat.startswith(".") and "*" not in pat:
        pat = "*" + pat
        rule_type = "extension"
    conn = _get_db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO cleanup_rules (pattern, rule_type, scope, description) VALUES (?, ?, ?, ?)",
            (pat, rule_type, scope or "app/*", description or "Regla personalizada de metadata"),
        )
        conn.commit()
    finally:
        conn.close()
    return get_rules_and_protected()


def delete_cleanup_rule(rule_id):
    init_housekeeper_tables()
    conn = _get_db()
    try:
        conn.execute("DELETE FROM cleanup_rules WHERE id = ?", (int(rule_id),))
        conn.commit()
    finally:
        conn.close()
    return get_rules_and_protected()


def _matches_junk(name, is_dir=False, rules=None):
    rules = rules or list()
    for r in rules:
        pat = r["pattern"]
        rtype = r["rule_type"]
        if is_dir and rtype == "folder" and fnmatch.fnmatch(name, pat):
            return True
        if not is_dir and rtype != "folder" and fnmatch.fnmatch(name, pat):
            return True
    return False


def _fmt_size(num_bytes):
    if num_bytes >= 1024 * 1024:
        return f"{round(num_bytes / (1024 * 1024), 2)} MB"
    if num_bytes >= 1024:
        return f"{round(num_bytes / 1024, 1)} KB"
    return f"{num_bytes} B"


def _dir_stats(path, rules):
    total_b, junk_b, junk_files = 0, 0, 0
    if not os.path.exists(path):
        return 0, 0, 0
    for root, dirs, files in os.walk(path):
        in_junk_folder = any(_matches_junk(part, True, rules) for part in root.split(os.sep))
        for fn in files:
            fp = os.path.join(root, fn)
            try:
                sz = os.path.getsize(fp)
            except OSError:
                sz = 0
            total_b += sz
            if in_junk_folder or _matches_junk(fn, False, rules):
                junk_b += sz
                junk_files += 1
    return total_b, junk_b, junk_files


def scan_storage():
    rules = get_rules_and_protected().get("rules") or list()
    folders = (
        ("static", "/static", os.path.join(APP_DIR, "static"), True),
        ("services", "app/services", os.path.join(APP_DIR, "services"), True),
        ("routes", "app/routes", os.path.join(APP_DIR, "routes"), True),
        ("templates", "app/templates", os.path.join(APP_DIR, "templates"), True),
        ("app_root", "app", APP_DIR, False),
    )

    items = list()
    total_junk_all = 0
    for fid, label, fpath, recursive in folders:
        if recursive:
            tot_b, jnk_b, jnk_cnt = _dir_stats(fpath, rules)
        else:
            tot_b, jnk_b, jnk_cnt = 0, 0, 0
            for fn in os.listdir(fpath):
                fp = os.path.join(fpath, fn)
                if os.path.isfile(fp):
                    sz = os.path.getsize(fp)
                    tot_b += sz
                    if _matches_junk(fn, False, rules):
                        jnk_b += sz
                        jnk_cnt += 1
                elif os.path.isdir(fp) and _matches_junk(fn, True, rules):
                    c_tot, c_jnk, c_cnt = _dir_stats(fp, rules)
                    tot_b += c_tot
                    jnk_b += c_jnk
                    jnk_cnt += c_cnt
        total_junk_all += jnk_b
        items.append({"id": fid, "label": label, "total_bytes": tot_b, "total_hr": _fmt_size(tot_b), "junk_bytes": jnk_b, "junk_hr": _fmt_size(jnk_b), "junk_files": jnk_cnt, "can_clean": jnk_b != 0})

    tmp_logs = [p for p in glob.glob("/tmp/cm-*") + glob.glob("/tmp/err.log") if os.path.isfile(p) and _matches_junk(os.path.basename(p), False, rules)]
    tmp_b = sum(os.path.getsize(p) for p in tmp_logs)
    total_junk_all += tmp_b
    items.append({"id": "tmp_logs", "label": "/tmp (logs app)", "total_bytes": tmp_b, "total_hr": _fmt_size(tmp_b), "junk_bytes": tmp_b, "junk_hr": _fmt_size(tmp_b), "junk_files": len(tmp_logs), "can_clean": tmp_b != 0})
    return {"ok": True, "items": items, "total_junk_hr": _fmt_size(total_junk_all), "total_junk_bytes": total_junk_all}


def clean_target(target_id):
    rules = get_rules_and_protected().get("rules") or list()
    removed = 0
    if target_id in ("all", "tmp_logs"):
        for p in glob.glob("/tmp/cm-*") + glob.glob("/tmp/err.log"):
            if os.path.isfile(p) and _matches_junk(os.path.basename(p), False, rules):
                try:
                    os.remove(p)
                    removed += 1
                except OSError:
                    pass

    folder_map = {"static": os.path.join(APP_DIR, "static"), "services": os.path.join(APP_DIR, "services"), "routes": os.path.join(APP_DIR, "routes"), "templates": os.path.join(APP_DIR, "templates"), "app_root": APP_DIR}
    targets = folder_map.values() if target_id == "all" else ([folder_map[target_id]] if target_id in folder_map else list())
    for base_p in targets:
        if not os.path.exists(base_p):
            continue
        for root, dirs, files in os.walk(base_p, topdown=False):
            for fn in files:
                fp = os.path.join(root, fn)
                if "metrics_live.db" in fn and _matches_junk(fn, False, rules):
                    try:
                        from app.services.metrics_store import clear_all_metrics
                        clear_all_metrics()
                        init_housekeeper_tables()
                        removed += 1
                    except Exception:
                        pass
                elif _matches_junk(fn, False, rules):
                    try:
                        os.remove(fp)
                        removed += 1
                    except OSError:
                        pass
            for d in dirs:
                if _matches_junk(d, True, rules):
                    try:
                        shutil.rmtree(os.path.join(root, d), ignore_errors=True)
                        removed += 1
                    except OSError:
                        pass
        if target_id == "app_root":
            break
    return {"ok": True, "removed": removed, "scan": scan_storage()}


def startup_audit():
    init_housekeeper_tables()
    res = scan_storage()
    logger.info(f"[Housekeeper] Auditoría de arranque: {res['total_junk_hr']} detectados.")
    return res

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sayumi local server.

Pure standard library. Serves the web interface and a small JSON API:

    GET  /api/health              service info
    GET  /api/state?key=NAME      read a stored JSON blob
    POST /api/state               write a stored JSON blob  {key, value}
    GET  /api/keys                list stored blob names
    GET  /api/files?dir=rel       list workspace entries
    GET  /api/file?path=rel       read a workspace text file
    GET  /api/scan                read every indexable file in the workspace
    POST /api/file                write a workspace text file {path, text}
    POST /api/upload              store a base64 payload  {name, data}
    POST /api/models              list the models a provider offers
    POST /api/embed               turn text into vectors for semantic recall
    POST /api/llm                 proxy a chat completion to an LLM provider
    POST /api/shutdown            stop the server (localhost only)

Everything under the data directory is sandboxed: paths that escape it are
rejected. The server binds to 127.0.0.1 only.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_NAME = "Sayumi"
# OpenAI compatible endpoints we ship a default address for
PROVIDER_BASES = {
    "cloudru": "https://foundation-models.api.cloud.ru/v1",
    "openai": "https://api.openai.com/v1",
}
APP_VERSION = "1.0.0"
MAX_BODY = 32 * 1024 * 1024

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("font/woff2", ".woff2")

STATE = {
    "root": "",
    "web": "",
    "data": "",
    "started": time.time(),
    "port": 0,
}

_SAFE_KEY = re.compile(r"^[A-Za-z0-9._-]{1,120}$")
_write_lock = threading.Lock()


# --------------------------------------------------------------------------- #
#  helpers
# --------------------------------------------------------------------------- #
_log_file = None


def log(message: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    line = "[%s] %s" % (stamp, message)
    try:
        print(line, flush=True)
    except Exception:
        pass
    # a copy on disk, so a launcher can show why a start failed
    if _log_file:
        try:
            _log_file.write(line + "\n")
            _log_file.flush()
        except Exception:
            pass


def ensure_dir(path: str) -> str:
    try:
        os.makedirs(path, exist_ok=True)
    except OSError:
        pass
    return path


def safe_join(base: str, rel: str) -> str | None:
    """Join *rel* onto *base*, refusing anything that escapes *base*."""
    rel = (rel or "").replace("\\", "/").lstrip("/")
    if not rel:
        return os.path.abspath(base)
    candidate = os.path.abspath(os.path.join(base, rel))
    base_abs = os.path.abspath(base)
    if candidate == base_abs:
        return candidate
    if not candidate.startswith(base_abs + os.sep):
        return None
    return candidate


def state_path(key: str) -> str | None:
    if not _SAFE_KEY.match(key or ""):
        return None
    return os.path.join(ensure_dir(os.path.join(STATE["data"], "state")), key + ".json")


def read_json_file(path: str, fallback=None):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return fallback


def write_json_file(path: str, value) -> bool:
    tmp = path + ".tmp"
    try:
        with _write_lock:
            with open(tmp, "w", encoding="utf-8") as handle:
                json.dump(value, handle, ensure_ascii=False, indent=2)
            os.replace(tmp, path)
        return True
    except Exception as exc:
        log("write failed %s: %s" % (path, exc))
        try:
            os.remove(tmp)
        except OSError:
            pass
        return False


# --------------------------------------------------------------------------- #
#  LLM providers
# --------------------------------------------------------------------------- #
def build_llm_request(payload: dict):
    """Return (url, headers, body_bytes, kind) for the configured provider."""
    provider = (payload.get("provider") or "openai").lower()
    model = payload.get("model") or "gpt-4o-mini"
    messages = payload.get("messages") or []
    api_key = payload.get("apiKey") or ""
    base = (payload.get("baseUrl") or "").rstrip("/")
    temperature = payload.get("temperature", 0.7)
    max_tokens = int(payload.get("maxTokens") or 2048)
    system = payload.get("system") or ""
    stream = bool(payload.get("stream"))

    if provider == "anthropic":
        url = (base or "https://api.anthropic.com") + "/v1/messages"
        headers = {
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        }
        body = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [m for m in messages if m.get("role") != "system"],
            "stream": stream,
        }
        if system:
            body["system"] = system
        return url, headers, json.dumps(body).encode("utf-8"), "anthropic"

    if provider == "ollama":
        url = (base or "http://127.0.0.1:11434") + "/api/chat"
        headers = {"content-type": "application/json"}
        full = ([{"role": "system", "content": system}] if system else []) + messages
        body = {
            "model": model,
            "messages": full,
            "stream": stream,
            "options": {"temperature": temperature},
        }
        return url, headers, json.dumps(body).encode("utf-8"), "ollama"

    # default: any OpenAI compatible endpoint
    # (OpenAI, Cloud.ru Foundation Models, LM Studio, vLLM, groq...)
    url = (base or PROVIDER_BASES.get(provider, PROVIDER_BASES["openai"])) + "/chat/completions"
    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = "Bearer " + api_key
    full = ([{"role": "system", "content": system}] if system else []) + messages
    body = {
        "model": model,
        "messages": full,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": stream,
    }
    return url, headers, json.dumps(body).encode("utf-8"), "openai"


def extract_text(kind: str, data: dict) -> str:
    try:
        if kind == "anthropic":
            parts = data.get("content") or []
            return "".join(p.get("text", "") for p in parts if isinstance(p, dict))
        if kind == "ollama":
            return (data.get("message") or {}).get("content", "")
        choices = data.get("choices") or []
        if choices:
            return (choices[0].get("message") or {}).get("content", "") or ""
    except Exception:
        pass
    return ""


# --------------------------------------------------------------------------- #
#  request handler
# --------------------------------------------------------------------------- #
class SayumiHandler(BaseHTTPRequestHandler):
    server_version = "Sayumi/" + APP_VERSION
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------ plumbing --
    def log_message(self, fmt, *args):  # noqa: A003 - silence default noise
        if os.environ.get("SAYUMI_VERBOSE"):
            log("%s %s" % (self.address_string(), fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def send_json(self, obj, status: int = 200) -> None:
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_text(self, text: str, status: int = 200, ctype="text/plain; charset=utf-8") -> None:
        raw = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def read_body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return {}
        if length <= 0 or length > MAX_BODY:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def query(self) -> dict:
        parsed = urllib.parse.urlparse(self.path)
        flat = {}
        for key, values in urllib.parse.parse_qs(parsed.query).items():
            flat[key] = values[0] if values else ""
        return flat

    # ------------------------------------------------------------- methods --
    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/"):
            return self.handle_api_get(path)
        return self.serve_static(path)

    def do_POST(self):  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        if not path.startswith("/api/"):
            return self.send_json({"ok": False, "error": "not found"}, 404)
        return self.handle_api_post(path)

    # ----------------------------------------------------------- static io --
    def serve_static(self, path: str):
        if path in ("/", ""):
            path = "/index.html"
        target = safe_join(STATE["web"], urllib.parse.unquote(path))
        if target is None:
            return self.send_text("forbidden", 403)
        if os.path.isdir(target):
            target = os.path.join(target, "index.html")
        if not os.path.isfile(target):
            return self.send_text("not found: " + path, 404)

        ctype, _ = mimetypes.guess_type(target)
        ctype = ctype or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/json", "text/javascript"):
            ctype += "; charset=utf-8"
        try:
            size = os.path.getsize(target)
            with open(target, "rb") as handle:
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(size))
                self.send_header("Cache-Control", "no-cache")
                self._cors()
                self.end_headers()
                chunk = handle.read(65536)
                while chunk:
                    self.wfile.write(chunk)
                    chunk = handle.read(65536)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except OSError as exc:
            self.send_text("read error: %s" % exc, 500)

    # --------------------------------------------------------------- api gets
    def handle_api_get(self, path: str):
        params = self.query()

        if path == "/api/health":
            return self.send_json(
                {
                    "ok": True,
                    "app": APP_NAME,
                    "version": APP_VERSION,
                    "python": sys.version.split()[0],
                    "root": STATE["root"],
                    "data": STATE["data"],
                    "port": STATE["port"],
                    "uptime": round(time.time() - STATE["started"], 1),
                }
            )

        if path == "/api/state":
            target = state_path(params.get("key", ""))
            if target is None:
                return self.send_json({"ok": False, "error": "bad key"}, 400)
            return self.send_json({"ok": True, "value": read_json_file(target)})

        if path == "/api/keys":
            folder = ensure_dir(os.path.join(STATE["data"], "state"))
            try:
                names = [f[:-5] for f in sorted(os.listdir(folder)) if f.endswith(".json")]
            except OSError:
                names = []
            return self.send_json({"ok": True, "keys": names})

        if path == "/api/files":
            base = ensure_dir(os.path.join(STATE["data"], "workspace"))
            target = safe_join(base, params.get("dir", ""))
            if target is None or not os.path.isdir(target):
                return self.send_json({"ok": False, "error": "bad dir"}, 400)
            entries = []
            try:
                for name in sorted(os.listdir(target)):
                    full = os.path.join(target, name)
                    entries.append(
                        {
                            "name": name,
                            "dir": os.path.isdir(full),
                            "size": os.path.getsize(full) if os.path.isfile(full) else 0,
                            "mtime": int(os.path.getmtime(full)),
                        }
                    )
            except OSError as exc:
                return self.send_json({"ok": False, "error": str(exc)}, 500)
            rel = os.path.relpath(target, base).replace("\\", "/")
            return self.send_json({"ok": True, "dir": "" if rel == "." else rel, "entries": entries})

        if path == "/api/scan":
            # walk the workspace and hand back readable text for indexing
            base = ensure_dir(os.path.join(STATE["data"], "workspace"))
            exts = {".txt", ".md", ".py", ".js", ".ts", ".json", ".html", ".css",
                    ".csv", ".yml", ".yaml", ".ini", ".cfg", ".sql", ".sh", ".bat",
                    ".java", ".c", ".h", ".cpp", ".go", ".rs", ".php", ".rb", ".xml"}
            skip = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"}
            budget = int(params.get("budget") or 1_500_000)
            files = []
            total = 0
            for folder, dirs, names in os.walk(base):
                dirs[:] = [d for d in dirs if d not in skip and not d.startswith(".")]
                for name in sorted(names):
                    ext = os.path.splitext(name)[1].lower()
                    if ext not in exts:
                        continue
                    full = os.path.join(folder, name)
                    try:
                        size = os.path.getsize(full)
                    except OSError:
                        continue
                    if size > 400_000 or total + size > budget:
                        continue
                    try:
                        with open(full, "r", encoding="utf-8", errors="replace") as handle:
                            text = handle.read(400_000)
                    except OSError:
                        continue
                    total += len(text)
                    files.append({
                        "path": os.path.relpath(full, base).replace("\\", "/"),
                        "size": size,
                        "mtime": int(os.path.getmtime(full)),
                        "text": text
                    })
                    if total >= budget:
                        break
                if total >= budget:
                    break
            return self.send_json({"ok": True, "files": files, "bytes": total})

        if path == "/api/file":
            base = ensure_dir(os.path.join(STATE["data"], "workspace"))
            target = safe_join(base, params.get("path", ""))
            if target is None or not os.path.isfile(target):
                return self.send_json({"ok": False, "error": "not found"}, 404)
            try:
                with open(target, "r", encoding="utf-8", errors="replace") as handle:
                    return self.send_json({"ok": True, "text": handle.read()})
            except OSError as exc:
                return self.send_json({"ok": False, "error": str(exc)}, 500)

        return self.send_json({"ok": False, "error": "unknown endpoint"}, 404)

    # -------------------------------------------------------------- api post
    def handle_api_post(self, path: str):
        body = self.read_body()

        if path == "/api/state":
            target = state_path(body.get("key", ""))
            if target is None:
                return self.send_json({"ok": False, "error": "bad key"}, 400)
            ok = write_json_file(target, body.get("value"))
            return self.send_json({"ok": ok})

        if path == "/api/file":
            base = ensure_dir(os.path.join(STATE["data"], "workspace"))
            target = safe_join(base, body.get("path", ""))
            if target is None:
                return self.send_json({"ok": False, "error": "bad path"}, 400)
            ensure_dir(os.path.dirname(target))
            try:
                with open(target, "w", encoding="utf-8") as handle:
                    handle.write(body.get("text") or "")
                return self.send_json({"ok": True})
            except OSError as exc:
                return self.send_json({"ok": False, "error": str(exc)}, 500)

        if path == "/api/upload":
            base = ensure_dir(os.path.join(STATE["data"], "uploads"))
            name = os.path.basename(body.get("name") or "file.bin")
            name = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:120] or "file.bin"
            target = os.path.join(base, "%d_%s" % (int(time.time()), name))
            try:
                raw = base64.b64decode((body.get("data") or "").split(",")[-1])
                with open(target, "wb") as handle:
                    handle.write(raw)
                return self.send_json({"ok": True, "path": os.path.basename(target)})
            except Exception as exc:
                return self.send_json({"ok": False, "error": str(exc)}, 500)

        if path == "/api/models":
            return self.handle_models(body)

        if path == "/api/embed":
            return self.handle_embed(body)

        if path == "/api/llm":
            return self.handle_llm(body)

        if path == "/api/shutdown":
            self.send_json({"ok": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return None

        return self.send_json({"ok": False, "error": "unknown endpoint"}, 404)

    # ------------------------------------------------------------- catalogue
    def handle_models(self, body: dict):
        """Ask the provider which models it actually offers."""
        provider = (body.get("provider") or "openai").lower()
        base = (body.get("baseUrl") or "").rstrip("/")
        key = body.get("apiKey") or ""

        if provider == "ollama":
            url = (base or "http://127.0.0.1:11434") + "/api/tags"
            headers = {}
        elif provider == "anthropic":
            url = (base or "https://api.anthropic.com") + "/v1/models"
            headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}
        else:
            url = (base or PROVIDER_BASES.get(provider, PROVIDER_BASES["openai"])) + "/models"
            headers = {}
            if key:
                headers["authorization"] = "Bearer " + key

        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:600]
            return self.send_json({"ok": False, "error": "HTTP %s" % exc.code, "detail": detail})
        except Exception as exc:
            return self.send_json({"ok": False, "error": str(exc)})

        models = []
        try:
            if provider == "ollama":
                models = [m.get("name", "") for m in (data.get("models") or [])]
            else:
                # model ids may contain a slash, keep them whole
                models = [m.get("id", "") for m in (data.get("data") or [])]
        except Exception:
            models = []
        models = sorted(set(m for m in models if m))
        return self.send_json({"ok": True, "models": models, "count": len(models)})

    # ------------------------------------------------------------ embeddings
    def handle_embed(self, body: dict):
        """Turn a batch of strings into vectors via an OpenAI style endpoint."""
        provider = (body.get("provider") or "openai").lower()
        base = (body.get("baseUrl") or "").rstrip("/")
        key = body.get("apiKey") or ""
        model = body.get("model") or ""
        texts = body.get("input") or []
        if not isinstance(texts, list) or not texts:
            return self.send_json({"ok": False, "error": "нечего векторизовать"}, 400)
        if not model:
            return self.send_json({"ok": False, "error": "не задана модель эмбеддингов"}, 400)
        texts = [str(t)[:4000] for t in texts[:64]]

        url = (base or PROVIDER_BASES.get(provider, PROVIDER_BASES["openai"])) + "/embeddings"
        headers = {"content-type": "application/json"}
        if key:
            headers["authorization"] = "Bearer " + key
        payload = json.dumps({"model": model, "input": texts}).encode("utf-8")
        request = urllib.request.Request(url, data=payload, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:600]
            return self.send_json({"ok": False, "error": "HTTP %s" % exc.code, "detail": detail})
        except Exception as exc:
            return self.send_json({"ok": False, "error": str(exc)})

        try:
            rows = sorted(data.get("data") or [], key=lambda r: r.get("index", 0))
            vectors = [r.get("embedding") for r in rows]
        except Exception:
            vectors = []
        if not vectors:
            return self.send_json({"ok": False, "error": "провайдер не вернул векторов"})
        return self.send_json({"ok": True, "vectors": vectors, "dim": len(vectors[0])})

    # ------------------------------------------------------------------ llm
    def handle_llm(self, body: dict):
        try:
            url, headers, payload, kind = build_llm_request(body)
        except Exception as exc:
            return self.send_json({"ok": False, "error": "bad request: %s" % exc}, 400)

        request = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        timeout = float(body.get("timeout") or 180)

        if not body.get("stream"):
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    data = json.loads(response.read().decode("utf-8"))
                return self.send_json({"ok": True, "text": extract_text(kind, data), "raw": data})
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", "replace")[:2000]
                return self.send_json({"ok": False, "error": "HTTP %s" % exc.code, "detail": detail}, 200)
            except Exception as exc:
                return self.send_json({"ok": False, "error": str(exc)}, 200)

        # streaming: relay as server sent events
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self._cors()
        self.end_headers()

        def emit(event: dict) -> bool:
            try:
                self.wfile.write(("data: " + json.dumps(event, ensure_ascii=False) + "\n\n").encode("utf-8"))
                self.wfile.flush()
                return True
            except (BrokenPipeError, ConnectionResetError, OSError):
                return False

        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                for raw_line in response:
                    line = raw_line.decode("utf-8", "replace").strip()
                    if not line:
                        continue
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    if line == "[DONE]":
                        break
                    try:
                        chunk = json.loads(line)
                    except Exception:
                        continue
                    piece = ""
                    if kind == "anthropic":
                        if chunk.get("type") == "content_block_delta":
                            piece = (chunk.get("delta") or {}).get("text", "")
                    elif kind == "ollama":
                        piece = (chunk.get("message") or {}).get("content", "")
                    else:
                        choices = chunk.get("choices") or []
                        if choices:
                            piece = (choices[0].get("delta") or {}).get("content", "") or ""
                    if piece and not emit({"delta": piece}):
                        return None
            emit({"done": True})
        except urllib.error.HTTPError as exc:
            emit({"error": "HTTP %s" % exc.code, "detail": exc.read().decode("utf-8", "replace")[:2000]})
        except Exception as exc:
            emit({"error": str(exc)})
        return None


# --------------------------------------------------------------------------- #
#  entry point
# --------------------------------------------------------------------------- #
def pick_port(preferred: int) -> int:
    for candidate in range(preferred, preferred + 40):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", candidate))
                return candidate
            except OSError:
                continue
    return preferred


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    default_root = os.path.dirname(here)

    parser = argparse.ArgumentParser(description="Sayumi local server")
    parser.add_argument("--port", type=int, default=8723)
    parser.add_argument("--root", default=default_root)
    parser.add_argument("--data", default="")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--no-pick-port", action="store_true")
    parser.add_argument("--log", default="", help="mirror the log into this file")
    args = parser.parse_args()

    global _log_file
    if args.log:
        try:
            ensure_dir(os.path.dirname(os.path.abspath(args.log)))
            _log_file = open(args.log, "w", encoding="utf-8")
        except OSError:
            _log_file = None

    root = os.path.abspath(args.root)
    STATE["root"] = root
    STATE["web"] = os.path.join(root, "web")
    STATE["data"] = os.path.abspath(args.data or os.path.join(root, "data"))

    if not os.path.isdir(STATE["web"]):
        log("web folder not found: %s" % STATE["web"])
        return 2

    for sub in ("state", "workspace", "uploads", "exports"):
        ensure_dir(os.path.join(STATE["data"], sub))

    port = args.port if args.no_pick_port else pick_port(args.port)
    STATE["port"] = port

    server = ThreadingHTTPServer((args.host, port), SayumiHandler)
    server.daemon_threads = True

    log("%s %s" % (APP_NAME, APP_VERSION))
    log("web   : %s" % STATE["web"])
    log("data  : %s" % STATE["data"])
    log("url   : http://%s:%d/" % (args.host, port))
    log("press Ctrl+C to stop")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("stopping")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        # whatever went wrong must end up in the log the launcher reads
        import traceback
        detail = traceback.format_exc()
        log("ОШИБКА ЗАПУСКА")
        log(detail)
        if not _log_file:
            print(detail, file=sys.stderr)
        sys.exit(1)

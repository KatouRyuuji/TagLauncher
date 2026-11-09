"""本机 HTTP mock：Anthropic Messages API 与 WebDAV。只监听 127.0.0.1 随机端口。"""
from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from email.utils import formatdate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote, urlsplit


@dataclass
class Req:
    method: str
    path: str
    headers: dict
    body: bytes
    t: float = field(default_factory=time.time)

    def json(self):
        return json.loads(self.body.decode("utf-8"))


class _Base:
    def __init__(self):
        self.requests: list[Req] = []
        self._lock = threading.Lock()
        outer = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def _handle(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(n) if n else b""
                r = Req(self.command, self.path, {k.lower(): v for k, v in self.headers.items()}, body)
                with outer._lock:
                    outer.requests.append(r)
                status, headers, data = outer.respond(r)
                self.send_response(status)
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(data)

            do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = _handle

            def __getattr__(self, name):
                if name.startswith("do_"):
                    return self._handle
                raise AttributeError(name)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.server.server_address[1]
        self._t = threading.Thread(target=self.server.serve_forever, daemon=True)
        self._t.start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def methods(self) -> list[str]:
        return [r.method for r in self.requests]

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    stop = close

    def start(self):  # 兼容旧接口：构造即已启动
        return self

    def respond(self, r: Req):  # pragma: no cover - override
        return 404, {}, b""


class AnthropicMock(_Base):
    """POST /v1/messages → {"content":[{"type":"text","text": <tags json>}]}。

    tagger(name, body) 返回标签列表；status_queue 可注入错误状态码。"""

    def __init__(self, tagger=None):
        self.tagger = tagger or (lambda name, body: ["自动标签"])
        self.status_queue: list[int] = []
        # 故障注入：hook(name, req) 返回 (status, headers, bytes) 覆盖响应；返回 None 走默认
        self.hook = None
        self.delay = 0.0
        super().__init__()

    def respond(self, r: Req):
        if self.status_queue:
            code = self.status_queue.pop(0)
            return code, {"Content-Type": "application/json"}, json.dumps({"error": {"message": f"mock {code}"}}).encode()
        if r.method != "POST" or not r.path.rstrip("/").endswith("/v1/messages"):
            return 404, {}, b""
        try:
            body = r.json()
            user = body["messages"][0]["content"]
        except Exception:
            body, user = {}, ""
        name = ""
        for line in str(user).splitlines():
            if line.startswith("Object name:"):
                name = line.split(":", 1)[1].strip()
        if self.delay and name:
            time.sleep(self.delay)
        if self.hook and name:
            out = self.hook(name, r)
            if out is not None:
                return out
        tags = self.tagger(name, body) if name else []
        text = json.dumps(tags, ensure_ascii=False) if name else "pong"
        out = {"id": "msg_e2e", "type": "message", "role": "assistant", "model": body.get("model", "m"),
               "content": [{"type": "text", "text": text}], "stop_reason": "end_turn"}
        return 200, {"Content-Type": "application/json"}, json.dumps(out, ensure_ascii=False).encode("utf-8")

    def message_requests(self) -> list[Req]:
        return [r for r in self.requests if r.method == "POST"]


class WebDavMock(_Base):
    """内存 WebDAV：PROPFIND / MKCOL / PUT / MOVE / GET / DELETE；校验 Basic auth。"""

    def __init__(self, user: str = "u", password: str = "p", prefix: str = ""):
        import base64
        self.user, self.password, self.prefix = user, password, prefix.strip("/")
        self.auth = "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()
        self.files: dict[str, bytes] = {}   # 路径（已解码，无前导/）→ 内容
        self.dirs: set[str] = {""}
        self.status_queue: list[int] = []
        # 故障注入：hook(name, req) 返回 (status, headers, bytes) 覆盖响应；返回 None 走默认
        self.hook = None
        self.delay = 0.0
        super().__init__()

    def _p(self, path: str) -> str:
        p = unquote(urlsplit(path).path).strip("/")
        if self.prefix and (p == self.prefix or p.startswith(self.prefix + "/")):
            p = p[len(self.prefix):].strip("/")
        return p

    def respond(self, r: Req):
        if r.headers.get("authorization") != self.auth:
            return 401, {"WWW-Authenticate": 'Basic realm="e2e"'}, b""
        if self.status_queue:
            return self.status_queue.pop(0), {}, b""
        if self.delay:
            time.sleep(self.delay)
        if self.hook:
            out = self.hook(r)
            if out is not None:
                return out
        p = self._p(r.path)
        m = r.method
        if m == "PROPFIND":
            if p not in self.dirs and p not in self.files:
                return 404, {}, b""
            depth = r.headers.get("depth", "1")
            entries = [(p, True if p in self.dirs else False)]
            if depth != "0" and p in self.dirs:
                pre = p + "/" if p else ""
                for f in sorted(self.files):
                    if f.startswith(pre) and "/" not in f[len(pre):]:
                        entries.append((f, False))
                for d in sorted(self.dirs):
                    if d and d.startswith(pre) and "/" not in d[len(pre):]:
                        entries.append((d, True))
            parts = ['<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">']
            for e, is_dir in entries:
                href = "/" + "/".join(x for x in (quote(self.prefix), quote(e)) if x) + ("/" if is_dir else "")
                prop = "<d:resourcetype><d:collection/></d:resourcetype>" if is_dir else (
                    f"<d:resourcetype/><d:getcontentlength>{len(self.files[e])}</d:getcontentlength>"
                    f"<d:getlastmodified>{formatdate(usegmt=True)}</d:getlastmodified>")
                parts.append(f"<d:response><d:href>{href}</d:href><d:propstat><d:prop>{prop}</d:prop>"
                             "<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>")
            parts.append("</d:multistatus>")
            return 207, {"Content-Type": "application/xml; charset=utf-8"}, "".join(parts).encode()
        if m == "MKCOL":
            if p in self.dirs:
                return 405, {}, b""
            self.dirs.add(p)
            return 201, {}, b""
        if m == "PUT":
            self.files[p] = r.body
            return 201, {}, b""
        if m == "MOVE":
            dst = self._p(r.headers.get("destination", ""))
            if p not in self.files:
                return 404, {}, b""
            if dst in self.files and r.headers.get("overwrite", "T").upper() == "F":
                return 412, {}, b""
            self.files[dst] = self.files.pop(p)
            return 201, {}, b""
        if m == "GET":
            if p not in self.files:
                return 404, {}, b""
            return 200, {"Content-Type": "application/octet-stream"}, self.files[p]
        if m == "DELETE":
            self.files.pop(p, None)
            return 204, {}, b""
        return 405, {}, b""


class EchoServer(_Base):
    """记录任意请求并回显（Mod net 权限等）。"""

    def respond(self, r: Req):
        return 200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}, json.dumps(
            {"method": r.method, "path": r.path}).encode()

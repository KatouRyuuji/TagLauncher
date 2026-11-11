"""AI 打标 P1/P2（E-AI-03/06/07/08/09/10/11/12/13）。后端真实请求本机 AnthropicMock；全部 CDP + IPC。"""
from __future__ import annotations

import json
import time

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until
from harness.mocks import AnthropicMock

KEY = "sk-e2e-ai-key-123456"


def configure(app, url, **over):
    cfg = {"baseUrl": url, "apiKey": KEY, "model": "claude-e2e", "autoTagOnAdd": False, "maxTags": 5,
           "allowNewTags": True, "extraPrompt": ""}
    cfg.update(over)
    app.invoke("ai_set_config", {"config": cfg})


def tags_of(sandbox):
    rows = dbh.query(sandbox.db_path, "SELECT i.name, t.name FROM item_tags it JOIN items i ON i.id=it.item_id "
                                      "JOIN tags t ON t.id=it.tag_id ORDER BY i.name, it.position")
    out: dict[str, list[str]] = {}
    for n, t in rows:
        out.setdefault(n, []).append(t)
    return out


def run_batch(app, button="为未打标对象打标", dlg=None):
    app.stub("plugin:dialog|message", "Yes")  # 永不弹原生确认框
    dlg = dlg or app.open_settings("AI 打标")
    dlg.get_by_role("button", name=button).click()
    return app.page.get_by_label("AI 打标进度")


def stat(prog, label):
    box = prog.get_by_text(label, exact=True).locator("xpath=..")
    return int(box.inner_text().split()[0])


def user_text(req):
    body = req.json()
    return "\n".join(c if isinstance(c, str) else "".join(p.get("text", "") for p in c)
                     for c in (m["content"] for m in body["messages"]))


@pytest.mark.case("E-AI-03")
def test_clear_key(app, ai_mock, sandbox):
    configure(app, ai_mock.url)
    dlg = app.open_settings("AI 打标")
    dlg.get_by_text("已配置", exact=True).wait_for(timeout=5000)
    dlg.get_by_role("button", name="清除密钥").click()
    app.wait_toast("已清除保存的 API 密钥")
    dlg.get_by_text("未配置", exact=True).wait_for(timeout=5000)
    assert app.invoke("ai_get_config")["hasApiKey"] is False
    assert not dbh.meta(sandbox.db_path, "ai.api_key")
    assert dlg.get_by_role("button", name="测试连接").is_disabled()


@pytest.mark.case("E-AI-06")
def test_allow_new_tags_off_uses_vocab_only(app, sandbox):
    m = AnthropicMock(lambda name, body: ["已有甲", "全新标签", "已有乙"])
    try:
        p = files.write(sandbox.files / "ai6" / "词表对象.txt", "x")
        app.seed([p])
        for t in ("已有甲", "已有乙"):
            app.add_tag(t)
        app.reload_page()  # IPC 建的标签要进前端词表
        app.close_welcome(3000)
        configure(app, m.url, allowNewTags=False)
        prog = run_batch(app)
        prog.get_by_text("打标完成").wait_for(timeout=30_000)
        assert tags_of(sandbox) == {"词表对象.txt": ["已有甲", "已有乙"]}
        assert "全新标签" not in app.tag_ids()
        req = m.message_requests()[-1]
        txt = user_text(req)
        assert "Existing tag vocabulary:" in txt and "已有甲" in txt and "已有乙" in txt, txt
        assert "MUST only choose tags from the provided vocabulary" in json.dumps(req.json(), ensure_ascii=False)
    finally:
        m.stop()


@pytest.mark.case("E-AI-07")
def test_max_tags_and_extra_prompt(app, sandbox):
    m = AnthropicMock(lambda name, body: [f"标{i}" for i in range(8)])
    try:
        p = files.write(sandbox.files / "ai7" / "上限对象.txt", "x")
        app.seed([p])
        configure(app, m.url, maxTags=2, extraPrompt="请使用项目代号作为标签")
        # UI 侧滑块与偏好文本回显
        dlg = app.open_settings("AI 打标")
        dlg.get_by_text("每个对象最多标签数 —— 2").wait_for(timeout=5000)
        assert dlg.get_by_label("补充打标偏好（可选）").input_value() == "请使用项目代号作为标签"
        prog = run_batch(app, dlg=dlg)
        prog.get_by_text("打标完成").wait_for(timeout=30_000)
        assert tags_of(sandbox) == {"上限对象.txt": ["标0", "标1"]}
        body = json.dumps(m.message_requests()[-1].json(), ensure_ascii=False)
        assert "up to 2 short" in body and "Additional user guidance: 请使用项目代号作为标签" in body
    finally:
        m.stop()


@pytest.mark.case("E-AI-08")
def test_cancel_keeps_finished(app, sandbox):
    m = AnthropicMock(lambda name, body: ["取消测试"])
    m.delay = 1.2
    try:
        ps = [files.write(sandbox.files / "ai8" / f"批{i:02d}.txt", "x") for i in range(12)]
        app.seed(ps)
        configure(app, m.url)
        prog = run_batch(app)
        wait_until(lambda: len(tags_of(sandbox)) >= 1, 20, lambda: tags_of(sandbox))
        prog.get_by_role("button", name="取消打标").click()
        prog.get_by_text("已取消打标").wait_for(timeout=10_000)
        time.sleep(1.5)  # 在途请求（≤并发 3）落地
        n_req = len(m.message_requests())
        time.sleep(3.0)
        assert len(m.message_requests()) == n_req, "取消后仍在发新请求"
        done = tags_of(sandbox)
        assert 1 <= len(done) < 12, done
        assert all(v == ["取消测试"] for v in done.values())
        assert n_req < 12
        # 已完成部分持久（重载后仍在）
        app.reload_page()
        app.close_welcome(3000)
        assert tags_of(sandbox) == done
    finally:
        m.stop()


@pytest.mark.case("E-AI-09")
def test_error_responses_per_object(app, sandbox):
    calls: dict[str, int] = {}

    def hook(name, req):
        calls[name] = calls.get(name, 0) + 1
        if name.startswith("坏JSON"):
            return 200, {"Content-Type": "application/json"}, b"{not json"
        if name.startswith("服务500"):
            return 500, {"Content-Type": "application/json"}, b'{"error":{"message":"boom"}}'
        if name.startswith("限流429"):
            if calls[name] == 1:
                return 429, {"Content-Type": "application/json"}, b'{"error":{"message":"slow down"}}'
            return None
        if name.startswith("拒绝400"):
            return 400, {"Content-Type": "application/json"}, json.dumps(
                {"error": {"message": f"bad key {KEY}"}}).encode()
        return None

    m = AnthropicMock(lambda name, body: ["正常"])
    m.hook = hook
    try:
        names = ["好的.txt", "坏JSON.txt", "服务500.txt", "限流429.txt", "拒绝400.txt"]
        app.seed([files.write(sandbox.files / "ai9" / n, "x") for n in names])
        configure(app, m.url)
        prog = run_batch(app)
        prog.get_by_text("打标完成").wait_for(timeout=60_000)
        assert stat(prog, "已打标") == 2 and stat(prog, "失败") == 3
        assert tags_of(sandbox) == {"好的.txt": ["正常"], "限流429.txt": ["正常"]}
        assert calls["限流429.txt"] == 2          # 429 重试一次后成功
        assert calls["服务500.txt"] == 3          # 5xx 最多重试 2 次
        assert calls["拒绝400.txt"] == 1          # 4xx 不重试
        text = prog.inner_text()
        assert KEY not in text and KEY not in json.dumps(app.toasts(), ensure_ascii=False)
        assert not app.js_errors()
    finally:
        m.stop()


@pytest.mark.case("E-AI-10")
def test_redirect_not_followed(app, sandbox):
    sink = AnthropicMock(lambda name, body: ["不应到达"])
    m = AnthropicMock(lambda name, body: ["x"])
    m.hook = lambda name, req: (302, {"Location": sink.url + "/v1/messages"}, b"")
    try:
        app.seed([files.write(sandbox.files / "ai10" / "重定向.txt", "x")])
        configure(app, m.url)
        err = app.invoke_error("ai_suggest_tags", {"name": "重定向.txt", "path": "p", "itemType": "file",
                                                   "existingTags": []})
        assert err and "302" in err, err
        assert KEY not in err
        time.sleep(0.5)
        assert sink.requests == [], "重定向被跟随（密钥可能泄露到第三方）"
        assert len(m.message_requests()) == 1
    finally:
        m.stop()
        sink.stop()


@pytest.mark.case("E-AI-11")
def test_auto_tag_on_add(app, ai_mock, sandbox):
    configure(app, ai_mock.url, autoTagOnAdd=True)
    a = files.write(sandbox.files / "ai11" / "自动A.txt", "x")
    b = files.write(sandbox.files / "ai11" / "自动B.txt", "x")
    app.drop_paths([str(a), str(b)])
    wait_until(lambda: tags_of(sandbox) == {"自动A.txt": ["测试标签", "示例"], "自动B.txt": ["测试标签", "示例"]},
               30, lambda: tags_of(sandbox))
    # 静默：不弹进度
    assert not app.page.get_by_label("AI 打标进度").is_visible()
    # 关闭后新对象不再自动打标
    configure(app, ai_mock.url, autoTagOnAdd=False)
    n = len(ai_mock.message_requests())
    c = files.write(sandbox.files / "ai11" / "手动C.txt", "x")
    app.drop_paths([str(c)])
    wait_until(lambda: "手动C.txt" in {i["name"] for i in app.items()}, 8)
    time.sleep(2.0)
    assert len(ai_mock.message_requests()) == n
    assert "手动C.txt" not in tags_of(sandbox)


@pytest.mark.case("E-AI-12")
def test_merge_not_overwrite(app, sandbox):
    m = AnthropicMock(lambda name, body: ["AI给的"])
    m.delay = 1.5
    try:
        ps = [files.write(sandbox.files / "ai12" / f"合并{i}.txt", "x") for i in range(5)]
        app.seed(ps)
        configure(app, m.url)
        prog = run_batch(app, "为全部重新打标")
        # 打标进行中，用户给最后一个（尚未处理）对象手动加标签
        wait_until(lambda: len(m.message_requests()) >= 1, 15)
        last = app.item("合并4.txt")
        tid = app.add_tag("手动加的")
        app.invoke("set_item_tags", {"itemId": last["id"], "tagIds": [tid]})
        prog.get_by_text("打标完成").wait_for(timeout=60_000)
        got = tags_of(sandbox)
        assert set(got["合并4.txt"]) == {"手动加的", "AI给的"}, got
        assert all(got[f"合并{i}.txt"] == ["AI给的"] for i in range(4)), got
    finally:
        m.stop()


@pytest.mark.case("E-AI-13")
def test_copy_cli_path(sandbox, app_factory):
    import shutil
    from pathlib import Path
    from harness import paths
    sandbox.bin.mkdir(parents=True, exist_ok=True)
    tl = paths.default_cli()
    if tl.exists():
        shutil.copy2(tl, sandbox.bin / "tl.exe")  # 安装版布局：tl.exe 与主程序同级
    app = app_factory()
    dlg = app.open_settings("AI 打标")
    if dlg.get_by_text("未检测到 tl.exe", exact=False).count():
        pytest.skip("被测构建旁无 tl.exe，命令行路径块不可用")
    expected = (sandbox.bin / "tl.exe").resolve()
    dlg.get_by_role("button", name="复制路径").click()
    app.wait_toast("路径已复制")
    raw = app.clipboard()[-1]
    assert Path(raw).resolve() == expected, raw
    shown = dlg.get_by_label("tl.exe 路径（与主程序同级，可复制到终端使用）").input_value()
    assert Path(shown).resolve() == expected, shown

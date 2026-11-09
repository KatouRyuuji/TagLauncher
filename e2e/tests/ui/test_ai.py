"""AI 打标（E-AI-*）：后端真实请求本机 AnthropicMock。"""
from __future__ import annotations

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until

KEY = "sk-e2e-ai-key-123456"


def fill(app, base_url: str, key: str = KEY, model: str = "claude-e2e"):
    dlg = app.open_settings("AI 打标")
    dlg.get_by_label("API 地址（Base URL）").fill(base_url)
    dlg.get_by_label("API 密钥").fill(key)
    dlg.get_by_label("模型", exact=True).fill(model)
    return dlg


@pytest.mark.case("E-AI-02")
def test_model_field_has_accessible_label(app):
    # BUG-03 回归：「模型」标签关联到带 datalist 的输入框
    dlg = app.open_settings("AI 打标")
    field = dlg.get_by_label("模型", exact=True)
    field.wait_for(timeout=3000)
    assert field.get_attribute("list") == "ai-model-candidates"


@pytest.mark.case("E-AI-01")
def test_connection(app, ai_mock):
    dlg = fill(app, ai_mock.url)
    dlg.get_by_role("button", name="测试连接").click()
    app.wait_toast("连接成功", timeout=15)
    reqs = ai_mock.message_requests()
    assert reqs and reqs[0].headers.get("x-api-key") == KEY


@pytest.mark.case("E-AI-02")
def test_key_never_returned(app, ai_mock, sandbox):
    dlg = fill(app, ai_mock.url)
    dlg.get_by_role("button", name="保存配置").click()
    app.wait_toast("AI 配置已保存")
    cfg = app.invoke("ai_get_config")
    assert cfg["hasApiKey"] is True and cfg["apiKey"] == "", cfg
    assert dbh.meta(sandbox.db_path, "ai.api_key") == KEY
    app.reload_page()
    app.close_welcome(3000)
    dlg = app.open_settings("AI 打标")
    inp = dlg.get_by_label("API 密钥")
    assert inp.input_value() == ""
    assert inp.get_attribute("placeholder") == "已保存密钥（留空表示不修改）"


@pytest.mark.case("E-AI-04")
def test_insecure_base_url_rejected(app):
    base = {"apiKey": KEY, "model": "m", "autoTagOnAdd": False, "maxTags": 3, "allowNewTags": True,
            "extraPrompt": ""}
    for bad in ("http://example.com", "http://localhost:1@evil.com"):
        err = app.invoke_error("ai_set_config", {"config": {**base, "baseUrl": bad}})
        assert err and "https" in err, (bad, err)
    app.invoke("ai_set_config", {"config": {**base, "baseUrl": "http://localhost:9"}})
    # UI 路径：保存时提示
    dlg = fill(app, "http://example.com")
    dlg.get_by_role("button", name="保存配置").click()
    app.wait_toast("保存失败：")


@pytest.mark.case("E-AI-05")
def test_tag_untagged(app, ai_mock, sandbox):
    ps = [files.write(sandbox.files / "ai" / f"待打标{i}.txt", "x") for i in (1, 2)]
    app.seed(ps)
    dlg = fill(app, ai_mock.url)
    dlg.get_by_role("button", name="保存配置").click()
    app.wait_toast("AI 配置已保存")
    # 批量打标前的原生确认框：plugin-dialog 的 ask() 走 plugin:dialog|message（YesNo），返回 "Yes" 即确认
    app.stub("plugin:dialog|message", "Yes")
    dlg.get_by_role("button", name="为未打标对象打标").click()
    ask = app.wait_ipc("plugin:dialog|message")[-1]
    assert "2 个对象" in str(ask), ask
    prog = app.page.get_by_label("AI 打标进度")
    prog.get_by_text("打标完成").wait_for(timeout=30_000)
    rows = dbh.query(sandbox.db_path, "SELECT i.name, t.name FROM item_tags it JOIN items i ON i.id=it.item_id "
                                      "JOIN tags t ON t.id=it.tag_id ORDER BY i.name, it.position")
    tagged = {}
    for n, t in rows:
        tagged.setdefault(n, []).append(t)
    assert tagged == {"待打标1.txt": ["测试标签", "示例"], "待打标2.txt": ["测试标签", "示例"]}, tagged
    assert len(ai_mock.message_requests()) == 2
    prog.get_by_role("button", name="查看结果（2）").click()
    wait_until(lambda: len(app.selected_ids()) == 2, 5, lambda: app.selected_ids())

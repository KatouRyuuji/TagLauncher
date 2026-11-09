"""搜索（E-SR-*）。期望集合由 Python 侧独立计算。"""
from __future__ import annotations

import time

import pytest

from harness import files


NAMES = ["项目报告.txt", "项目计划.md", "会议记录.txt", "文件夹测试.txt", "音乐清单.txt", "视频剪辑.txt", "图片素材.txt"]


@pytest.fixture
def corpus(app, sandbox):
    paths = [files.write(sandbox.files / "sr" / n, n) for n in NAMES]
    app.seed(paths)
    return NAMES


@pytest.mark.case("E-SR-01")
def test_keyword_and_highlight(app, corpus):
    app.page.locator("body").click(position={"x": 5, "y": 5})
    app.page.keyboard.press("F3")
    box = app.page.locator("#workspace-search")
    assert box.evaluate("el => el === document.activeElement")
    box.press_sequentially("项目", delay=30)
    app.wait_names(["项目报告.txt", "项目计划.md"])
    marks = app.page.locator("mark.search-highlight")
    marks.first.wait_for()
    assert {m.inner_text() for m in marks.all()} == {"项目"}


@pytest.mark.case("E-SR-02")
@pytest.mark.parametrize("q", ["wjj", "wenjianjia"])
def test_pinyin(app, corpus, q):
    app.search(q)
    app.wait_names(["文件夹测试.txt"])


@pytest.mark.case("E-SR-03")
@pytest.mark.parametrize("q,expect", [
    ("项目 && 报告", ["项目报告.txt"]),
    ("音乐 || 视频", ["音乐清单.txt", "视频剪辑.txt"]),
    ("项目 && !!计划", ["项目报告.txt"]),
    ("(音乐 || 视频) && 清单", ["音乐清单.txt"]),
    ("@wjj", []),
    ("@文件夹", []),
    ("@文件夹测试.txt", ["文件夹测试.txt"]),
])
def test_expressions(app, corpus, q, expect):
    app.search(q)
    if expect:
        app.wait_names(expect)
    else:
        time.sleep(1.0)
        assert app.visible_names() == []

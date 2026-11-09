"""E-ERR-04：整套 UI 用例期间不应有未捕获 JS 错误（文件名 zz 保证最后收集/执行）。"""
from __future__ import annotations

import pytest


@pytest.mark.case("E-ERR-04")
def test_no_uncaught_js_errors(js_error_log):
    if not js_error_log:
        return
    lines = [f"{nid}: {e}" for nid, errs in js_error_log for e in errs]
    pytest.fail("UI 用例期间出现未捕获 JS 错误：\n" + "\n".join(lines[:50]))

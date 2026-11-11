// CI 探针替身：冒充 tag-launcher.exe，记录自己是否继承了包标识、AppData 写入是否被虚拟化。
#include <windows.h>
#include <appmodel.h>
#include <shlobj_core.h>
#include <cstdio>
#include <string>
int wmain(int argc, wchar_t** argv) {
    wchar_t name[512] = {};
    UINT32 len = ARRAYSIZE(name);
    LONG rc = GetCurrentPackageFullName(&len, name);
    PWSTR la = nullptr;
    SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &la);
    std::wstring dir = std::wstring(la) + L"\\TagLauncher";
    CoTaskMemFree(la);
    CreateDirectoryW(dir.c_str(), nullptr);
    FILE* w = _wfopen((dir + L"\\child-wrote.txt").c_str(), L"w");
    if (w) { fputs("child", w); fclose(w); }
    FILE* f = _wfopen(L"C:\\Users\\Public\\tl-menu-child.txt", L"a, ccs=UTF-8");
    if (!f) return 1;
    fwprintf(f, L"pkg=%s rc=%ld args=", rc == ERROR_SUCCESS ? name : L"(none)", rc);
    for (int i = 1; i < argc; ++i) fwprintf(f, L"[%s]", argv[i]);
    fwprintf(f, L"\n");
    fclose(f);
    return 0;
}

// TagLauncher Win11 一级右键菜单：IExplorerCommand 进程外（dllhost 代理）COM 服务器。
// 由未签名稀疏包（Publisher 含 Unsigned OID）注册，不需要任何证书。
// Invoke：把选中路径交给 tag-launcher.exe（--collect <paths>），与经典菜单/发送到同一入口。
// TL_MENU_PROBE 构建（CI 探针）额外把路径写入 %LOCALAPPDATA%\TagLauncher\win11-menu-invoked.txt 与公共目录。
#include <windows.h>
#include <shobjidl_core.h>
#include <shlwapi.h>
#include <shlobj_core.h>
#include <exdisp.h>
#include <shldisp.h>
#include <new>
#include <string>

// {6F3B7A51-2C1E-4E8B-9A57-3D8E1B4C9F21}
static const CLSID CLSID_TagLauncherMenu = {0x6f3b7a51, 0x2c1e, 0x4e8b, {0x9a, 0x57, 0x3d, 0x8e, 0x1b, 0x4c, 0x9f, 0x21}};
static long g_objects = 0;
static long g_locks = 0;
static HMODULE g_module = nullptr;

static std::wstring ModuleDir() {
    wchar_t buf[MAX_PATH * 4] = {};
    GetModuleFileNameW(g_module, buf, ARRAYSIZE(buf));
    PathRemoveFileSpecW(buf);
    return buf;
}

// 程序目录：DLL 在 <程序目录>\win11-menu\ 下（tauri resources），exe 在上一级；探针布局里 exe 与 DLL 同级
static std::wstring FindExe() {
    std::wstring dir = ModuleDir();
    std::wstring same = dir + L"\\tag-launcher.exe";
    if (GetFileAttributesW(same.c_str()) != INVALID_FILE_ATTRIBUTES) return same;
    wchar_t parent[MAX_PATH * 4] = {};
    lstrcpynW(parent, dir.c_str(), ARRAYSIZE(parent));
    PathRemoveFileSpecW(parent);
    std::wstring up = std::wstring(parent) + L"\\tag-launcher.exe";
    if (GetFileAttributesW(up.c_str()) != INVALID_FILE_ATTRIBUTES) return up;
    return std::wstring();
}

static void AppendMarker(const std::wstring& text) {
    PWSTR base = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &base))) return;
    std::wstring dir = std::wstring(base) + L"\\TagLauncher";
    CoTaskMemFree(base);
    CreateDirectoryW(dir.c_str(), nullptr);
    std::wstring file = dir + L"\\win11-menu-invoked.txt";
    HANDLE h = CreateFileW(file.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return;
    int n = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), (int)text.size(), nullptr, 0, nullptr, nullptr);
    std::string utf8(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.c_str(), (int)text.size(), utf8.data(), n, nullptr, nullptr);
    DWORD written = 0;
    WriteFile(h, utf8.data(), (DWORD)utf8.size(), &written, nullptr);
    CloseHandle(h);
#ifdef TL_MENU_PROBE
    // 探针构建：额外写到不受 AppData 虚拟化影响的公共目录，用来判定 dllhost 是否被虚拟化
    HANDLE p = CreateFileW(L"C:\\Users\\Public\\tl-menu-invoked.txt", FILE_APPEND_DATA, FILE_SHARE_READ, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (p != INVALID_HANDLE_VALUE) { WriteFile(p, utf8.data(), (DWORD)utf8.size(), &written, nullptr); CloseHandle(p); }
#endif
}

// 经桌面 explorer 启动：子进程挂在 explorer 下，不继承本 dllhost 的包标识与 AppData 虚拟化。
// 做法同 Raymond Chen《How can I launch an unelevated process from my elevated process》。
static HRESULT ShellExecuteViaExplorer(const std::wstring& file, const std::wstring& args) {
    IShellWindows* windows = nullptr;
    HRESULT hr = CoCreateInstance(CLSID_ShellWindows, nullptr, CLSCTX_LOCAL_SERVER, IID_PPV_ARGS(&windows));
    if (FAILED(hr)) return hr;
    VARIANT empty = {};
    long hwnd = 0;
    IDispatch* desktop = nullptr;
    hr = windows->FindWindowSW(&empty, &empty, SWC_DESKTOP, &hwnd, SWFO_NEEDDISPATCH, &desktop);
    windows->Release();
    if (hr != S_OK || !desktop) return FAILED(hr) ? hr : E_FAIL;
    IServiceProvider* sp = nullptr;
    hr = desktop->QueryInterface(IID_PPV_ARGS(&sp));
    desktop->Release();
    if (FAILED(hr)) return hr;
    IShellBrowser* browser = nullptr;
    hr = sp->QueryService(SID_STopLevelBrowser, IID_PPV_ARGS(&browser));
    sp->Release();
    if (FAILED(hr)) return hr;
    IShellView* view = nullptr;
    hr = browser->QueryActiveShellView(&view);
    browser->Release();
    if (FAILED(hr)) return hr;
    IDispatch* bg = nullptr;
    hr = view->GetItemObject(SVGIO_BACKGROUND, IID_PPV_ARGS(&bg));
    view->Release();
    if (FAILED(hr)) return hr;
    IShellFolderViewDual* folderView = nullptr;
    hr = bg->QueryInterface(IID_PPV_ARGS(&folderView));
    bg->Release();
    if (FAILED(hr)) return hr;
    IDispatch* app = nullptr;
    hr = folderView->get_Application(&app);
    folderView->Release();
    if (FAILED(hr)) return hr;
    IShellDispatch2* shell = nullptr;
    hr = app->QueryInterface(IID_PPV_ARGS(&shell));
    app->Release();
    if (FAILED(hr)) return hr;
    BSTR bFile = SysAllocString(file.c_str());
    VARIANT vArgs; VariantInit(&vArgs); vArgs.vt = VT_BSTR; vArgs.bstrVal = SysAllocString(args.c_str());
    VARIANT vDir; VariantInit(&vDir);
    VARIANT vOp; VariantInit(&vOp); vOp.vt = VT_BSTR; vOp.bstrVal = SysAllocString(L"open");
    VARIANT vShow; VariantInit(&vShow); vShow.vt = VT_I4; vShow.lVal = SW_SHOWNORMAL;
    hr = shell->ShellExecute(bFile, vArgs, vDir, vOp, vShow);
    SysFreeString(bFile); VariantClear(&vArgs); VariantClear(&vOp);
    shell->Release();
    return hr;
}

class TagLauncherCommand final : public IExplorerCommand {
    long refs_ = 1;
public:
    TagLauncherCommand() { InterlockedIncrement(&g_objects); }
    ~TagLauncherCommand() { InterlockedDecrement(&g_objects); }
    IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == __uuidof(IExplorerCommand)) {
            *ppv = static_cast<IExplorerCommand*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&refs_); }
    IFACEMETHODIMP_(ULONG) Release() override {
        long r = InterlockedDecrement(&refs_);
        if (r == 0) delete this;
        return r;
    }
    IFACEMETHODIMP GetTitle(IShellItemArray*, LPWSTR* name) override { return SHStrDupW(L"用 TagLauncher 收纳", name); }
    IFACEMETHODIMP GetIcon(IShellItemArray*, LPWSTR* icon) override {
        std::wstring exe = FindExe();
        if (exe.empty()) { *icon = nullptr; return E_NOTIMPL; }
        return SHStrDupW((exe + L",0").c_str(), icon);
    }
    IFACEMETHODIMP GetToolTip(IShellItemArray*, LPWSTR* tip) override { *tip = nullptr; return E_NOTIMPL; }
    IFACEMETHODIMP GetCanonicalName(GUID* guid) override { *guid = CLSID_TagLauncherMenu; return S_OK; }
    IFACEMETHODIMP GetState(IShellItemArray*, BOOL, EXPCMDSTATE* state) override { *state = ECS_ENABLED; return S_OK; }
    IFACEMETHODIMP GetFlags(EXPCMDFLAGS* flags) override { *flags = ECF_DEFAULT; return S_OK; }
    IFACEMETHODIMP EnumSubCommands(IEnumExplorerCommand** e) override { *e = nullptr; return E_NOTIMPL; }
    IFACEMETHODIMP Invoke(IShellItemArray* items, IBindCtx*) override {
        if (!items) return S_OK;
        DWORD count = 0;
        items->GetCount(&count);
        std::wstring args = L"--collect";
        std::wstring marker;
        for (DWORD i = 0; i < count; ++i) {
            IShellItem* item = nullptr;
            if (FAILED(items->GetItemAt(i, &item))) continue;
            PWSTR path = nullptr;
            if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))) {
                args += L" \"";
                args += path;
                args += L"\"";
                marker += path;
                marker += L"\n";
                CoTaskMemFree(path);
            }
            item->Release();
        }
#ifdef TL_MENU_PROBE
        AppendMarker(marker);
#endif
        std::wstring exe = FindExe();
        if (!exe.empty()) {
#ifdef TL_MENU_PROBE
            // 探针：两条启动路径都走一遍，子进程替身记录各自是否带包标识
            ShellExecuteW(nullptr, L"open", exe.c_str(), (L"--via=direct " + args).c_str(), nullptr, SW_SHOWNORMAL);
            HRESULT viaHr = ShellExecuteViaExplorer(exe, L"--via=explorer " + args);
            wchar_t note[64];
            wsprintfW(note, L"via_explorer_hr=0x%08X\n", (unsigned)viaHr);
            AppendMarker(note);
#else
            // 经桌面 explorer 启动，TagLauncher 不继承 dllhost 的包标识；explorer 不可用时退回直接启动
            if (FAILED(ShellExecuteViaExplorer(exe, args))) {
                ShellExecuteW(nullptr, L"open", exe.c_str(), args.c_str(), nullptr, SW_SHOWNORMAL);
            }
#endif
        }
        return S_OK;
    }
};

class Factory final : public IClassFactory {
public:
    IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_IClassFactory) { *ppv = static_cast<IClassFactory*>(this); return S_OK; }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    IFACEMETHODIMP_(ULONG) AddRef() override { return 2; }
    IFACEMETHODIMP_(ULONG) Release() override { return 1; }
    IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) override {
        if (outer) return CLASS_E_NOAGGREGATION;
        auto* cmd = new (std::nothrow) TagLauncherCommand();
        if (!cmd) return E_OUTOFMEMORY;
        HRESULT hr = cmd->QueryInterface(riid, ppv);
        cmd->Release();
        return hr;
    }
    IFACEMETHODIMP LockServer(BOOL lock) override {
        if (lock) InterlockedIncrement(&g_locks); else InterlockedDecrement(&g_locks);
        return S_OK;
    }
};
static Factory g_factory;

extern "C" BOOL WINAPI DllMain(HINSTANCE inst, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) { g_module = inst; DisableThreadLibraryCalls(inst); }
    return TRUE;
}
extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid, REFIID riid, void** ppv) {
    if (clsid != CLSID_TagLauncherMenu) return CLASS_E_CLASSNOTAVAILABLE;
    return g_factory.QueryInterface(riid, ppv);
}
extern "C" HRESULT __stdcall DllCanUnloadNow() { return (g_objects == 0 && g_locks == 0) ? S_OK : S_FALSE; }

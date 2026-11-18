// TagLauncher Win11 一级右键菜单：IExplorerCommand 进程外（dllhost 代理）COM 服务器。
// 由未签名稀疏包（Publisher 含 Unsigned OID）注册，不需要任何证书。
// Invoke：把选中路径交给 tag-launcher.exe（--tl-menu-req <id> --collect <paths>），与经典菜单/发送到同一入口。
// TL_MENU_PROBE 构建（CI 探针）额外把路径写入 %LOCALAPPDATA%\TagLauncher\win11-menu-invoked.txt 与公共目录。
#include <windows.h>
#include <shobjidl_core.h>
#include <shlwapi.h>
#include <shlobj_core.h>
#include <exdisp.h>
#include <shldisp.h>
#include <new>
#include <string>
#include <bcrypt.h>
#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "advapi32.lib")

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

// 程序目录：DLL 在 <程序目录>\win11-menu\ 下（tauri resources），exe 在上一级；探针布局里 exe 与 DLL 同级。
// 若包加载路径与 ExternalLocation 不一致，回退读注册时写入的 tl_menu.host（一行 UTF-8 绝对路径）。
static bool ExeExists(const std::wstring& path) {
    DWORD attr = GetFileAttributesW(path.c_str());
    return attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

static bool CanonicalizePath(const std::wstring& in, std::wstring& out) {
    wchar_t buf[MAX_PATH * 4] = {};
    DWORD n = GetFullPathNameW(in.c_str(), ARRAYSIZE(buf), buf, nullptr);
    if (n == 0 || n >= ARRAYSIZE(buf)) return false;
    out.assign(buf, n);
    return true;
}

// 仅允许真实存在的 tag-launcher.exe，且必须是：模块同级、模块上一级，
// 或宿主目录符合安装/探针布局（含 win11-menu\tl_menu.dll 或 exe 旁的 tl_menu.dll）。
// 禁止把任意同名 exe 当宿主。
static bool IsCanonicalHost(const std::wstring& candidate, std::wstring& resolved) {
    if (candidate.empty()) return false;
    const wchar_t* name = PathFindFileNameW(candidate.c_str());
    if (!name || lstrcmpiW(name, L"tag-launcher.exe") != 0) return false;
    std::wstring full;
    if (!CanonicalizePath(candidate, full) || !ExeExists(full)) return false;
    if (lstrcmpiW(PathFindFileNameW(full.c_str()), L"tag-launcher.exe") != 0) return false;

    std::wstring dir = ModuleDir();
    std::wstring same = dir + L"\\tag-launcher.exe";
    wchar_t parent[MAX_PATH * 4] = {};
    lstrcpynW(parent, dir.c_str(), ARRAYSIZE(parent));
    PathRemoveFileSpecW(parent);
    std::wstring up = std::wstring(parent) + L"\\tag-launcher.exe";

    std::wstring sameFull, upFull;
    if (CanonicalizePath(same, sameFull) && lstrcmpiW(full.c_str(), sameFull.c_str()) == 0) {
        resolved = full;
        return true;
    }
    if (parent[0] != 0 && CanonicalizePath(up, upFull) && lstrcmpiW(full.c_str(), upFull.c_str()) == 0) {
        resolved = full;
        return true;
    }
    // 当 DLL 从包缓存加载、ModuleDir 不是程序目录时，仍接受符合安装/探针布局的宿主：
    // 程序目录下有 win11-menu\tl_menu.dll，或 exe 旁有 tl_menu.dll。
    wchar_t exeDir[MAX_PATH * 4] = {};
    lstrcpynW(exeDir, full.c_str(), ARRAYSIZE(exeDir));
    PathRemoveFileSpecW(exeDir);
    std::wstring bundled = std::wstring(exeDir) + L"\\win11-menu\\tl_menu.dll";
    std::wstring probeDll = std::wstring(exeDir) + L"\\tl_menu.dll";
    if (ExeExists(bundled) || ExeExists(probeDll)) {
        resolved = full;
        return true;
    }
    return false;
}

static std::wstring DecodeHostContents(HANDLE h) {
    char buf[4096];
    DWORD n = 0;
    BOOL ok = ReadFile(h, buf, sizeof(buf) - 1, &n, nullptr);
    CloseHandle(h);
    if (!ok || n == 0) return {};
    buf[n] = 0;
    // 去掉换行与首尾空白，不把路径写进状态日志
    while (n > 0 && (buf[n - 1] == '\n' || buf[n - 1] == '\r' || buf[n - 1] == ' ' || buf[n - 1] == '\t')) {
        buf[--n] = 0;
    }
    int wlen = MultiByteToWideChar(CP_UTF8, 0, buf, n, nullptr, 0);
    if (wlen <= 0) return {};
    std::wstring out((size_t)wlen, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, buf, n, out.data(), wlen);
    return out;
}


static std::wstring KnownTagLauncherDir() {
    PWSTR base = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &base))) return {};
    std::wstring dir = std::wstring(base) + L"\\TagLauncher";
    CoTaskMemFree(base);
    if (!dir.empty()) CreateDirectoryW(dir.c_str(), nullptr);
    return dir;
}

static std::wstring ReadHostFile(const std::wstring& file) {
    HANDLE h = CreateFileW(file.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return {};
    return DecodeHostContents(h);
}

static DWORD IntegrityRid(HANDLE process) {
    HANDLE tok = nullptr;
    if (!OpenProcessToken(process, TOKEN_QUERY, &tok)) return 0;
    DWORD n = 0;
    GetTokenInformation(tok, TokenIntegrityLevel, nullptr, 0, &n);
    if (n == 0 || n > 256) { CloseHandle(tok); return 0; }
    BYTE buf[256];
    if (!GetTokenInformation(tok, TokenIntegrityLevel, buf, n, &n)) { CloseHandle(tok); return 0; }
    CloseHandle(tok);
    auto* til = reinterpret_cast<TOKEN_MANDATORY_LABEL*>(buf);
    if (!til->Label.Sid) return 0;
    UCHAR count = *GetSidSubAuthorityCount(til->Label.Sid);
    if (count == 0) return 0;
    return *GetSidSubAuthority(til->Label.Sid, count - 1);
}

static std::string Sha256Raw(const void* data, ULONG len) {
    BCRYPT_ALG_HANDLE alg = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    std::string hex;
    if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) return {};
    if (BCryptCreateHash(alg, &hash, nullptr, 0, nullptr, 0, 0) == 0) {
        if (BCryptHashData(hash, (PUCHAR)data, len, 0) == 0) {
            UCHAR dig[32];
            if (BCryptFinishHash(hash, dig, 32, 0) == 0) {
                hex.resize(64);
                static const char* k = "0123456789abcdef";
                for (int i = 0; i < 32; i++) {
                    hex[i * 2] = k[dig[i] >> 4];
                    hex[i * 2 + 1] = k[dig[i] & 0xf];
                }
            }
        }
        BCryptDestroyHash(hash);
    }
    BCryptCloseAlgorithmProvider(alg, 0);
    return hex;
}

static std::string SaltedPathHash(const std::wstring& req, const std::wstring& path) {
    std::wstring key = path;
    for (auto& c : key) if (c == L'/') c = L'\\';
    while (key.size() > 1 && (key.back() == L'\\' )) key.pop_back();
    for (auto& c : key) if (c >= L'A' && c <= L'Z') c = (wchar_t)(c - L'A' + L'a');
    std::wstring src = req + L":" + key;
    int n = WideCharToMultiByte(CP_UTF8, 0, src.c_str(), (int)src.size(), nullptr, 0, nullptr, nullptr);
    if (n <= 0) return {};
    std::string utf8((size_t)n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, src.c_str(), (int)src.size(), utf8.data(), n, nullptr, nullptr);
    return Sha256Raw(utf8.data(), (ULONG)utf8.size());
}

static std::wstring NewRequestId() {
    GUID g{};
    if (FAILED(CoCreateGuid(&g))) {
        wchar_t b[48];
        wsprintfW(b, L"%08X%08X", GetCurrentProcessId(), GetTickCount());
        return b;
    }
    wchar_t b[33];
    wsprintfW(b, L"%08X%04X%04X%02X%02X%02X%02X%02X%02X%02X%02X",
        g.Data1, g.Data2, g.Data3, g.Data4[0], g.Data4[1], g.Data4[2], g.Data4[3],
        g.Data4[4], g.Data4[5], g.Data4[6], g.Data4[7]);
    return b;
}

// 只用显式宽字符数转换（不含 NUL）。WideCharToMultiByte(..., -1, ...) 的字节数含末尾 NUL，
// 若按 n-1 分配却仍传 -1，转换因容量不足失败，写出的便是预填的 NUL。
static bool WideToUtf8(const wchar_t* line, std::string& utf8) {
    int wlen = lstrlenW(line);
    if (wlen <= 0) return false;
    int nbytes = WideCharToMultiByte(CP_UTF8, 0, line, wlen, nullptr, 0, nullptr, nullptr);
    if (nbytes <= 0) return false;
    utf8.assign((size_t)nbytes, '\0');
    int written = WideCharToMultiByte(CP_UTF8, 0, line, wlen, utf8.data(), nbytes, nullptr, nullptr);
    if (written <= 0) { utf8.clear(); return false; }
    utf8.resize((size_t)written);
    return true;
}

// 只写结果码与哈希，不写路径，避免泄漏用户文件位置。
// 与 Rust 侧一致：READ+WRITE 共享，有界保留；写失败用错误码记录，不写路径。
static const DWORD kLogMax = 256 * 1024;
static const DWORD kLogKeep = 64 * 1024;

static bool IsValidNonce(const std::wstring& s) {
    size_t n = s.size();
    if (n != 16 && n != 32) return false;
    for (wchar_t c : s) {
        bool ok = (c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f') || (c >= L'A' && c <= L'F');
        if (!ok) return false;
    }
    return true;
}

static std::wstring ReqForLog(const std::wstring& req) {
    return IsValidNonce(req) ? req : L"invalid_req";
}

static DWORD AppendBounded(const std::wstring& file, const std::string& utf8) {
    HANDLE h = CreateFileW(file.c_str(), GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return GetLastError() ? GetLastError() : ERROR_OPEN_FAILED;
    if (!LockFile(h, 0, 0, 0xFFFFFFFF, 0xFFFFFFFF)) {
        DWORD err = GetLastError();
        CloseHandle(h);
        return err ? err : ERROR_LOCK_VIOLATION;
    }
    DWORD err = 0;
    LARGE_INTEGER sz{};
    if (!GetFileSizeEx(h, &sz)) {
        err = GetLastError() ? GetLastError() : ERROR_READ_FAULT;
    } else {
        auto trim = [&]() -> DWORD {
            LARGE_INTEGER cur{};
            if (!GetFileSizeEx(h, &cur)) return GetLastError() ? GetLastError() : ERROR_READ_FAULT;
            if (cur.QuadPart <= (LONGLONG)kLogMax) return 0;
            LARGE_INTEGER startPos;
            startPos.QuadPart = cur.QuadPart > (LONGLONG)kLogKeep ? cur.QuadPart - (LONGLONG)kLogKeep : 0;
            if (!SetFilePointerEx(h, startPos, nullptr, FILE_BEGIN)) {
                return GetLastError() ? GetLastError() : ERROR_SEEK;
            }
            std::string buf;
            buf.resize((size_t)(cur.QuadPart - startPos.QuadPart));
            DWORD got = 0;
            if (!ReadFile(h, buf.data(), (DWORD)buf.size(), &got, nullptr)) {
                return GetLastError() ? GetLastError() : ERROR_READ_FAULT;
            }
            buf.resize(got);
            size_t nl = buf.find('\n');
            if (nl != std::string::npos) buf.erase(0, nl + 1);
            if (SetFilePointer(h, 0, nullptr, FILE_BEGIN) == INVALID_SET_FILE_POINTER && GetLastError() != NO_ERROR) {
                return GetLastError();
            }
            if (!SetEndOfFile(h)) return GetLastError() ? GetLastError() : ERROR_WRITE_FAULT;
            DWORD w = 0;
            if (!WriteFile(h, buf.data(), (DWORD)buf.size(), &w, nullptr)) {
                return GetLastError() ? GetLastError() : ERROR_WRITE_FAULT;
            }
            return 0;
        };
        err = trim();
        if (!err) {
            if (SetFilePointer(h, 0, nullptr, FILE_END) == INVALID_SET_FILE_POINTER && GetLastError() != NO_ERROR) {
                err = GetLastError();
            } else {
                DWORD written = 0;
                if (!WriteFile(h, utf8.data(), (DWORD)utf8.size(), &written, nullptr) || written != (DWORD)utf8.size()) {
                    err = GetLastError() ? GetLastError() : ERROR_WRITE_FAULT;
                } else {
                    err = trim();
                }
            }
        }
    }
    UnlockFile(h, 0, 0, 0xFFFFFFFF, 0xFFFFFFFF);
    CloseHandle(h);
    return err;
}

static void AppendStatus(const wchar_t* line) {
    std::wstring dir = KnownTagLauncherDir();
    if (dir.empty()) return;
    std::wstring file = dir + L"\\win11-menu-status.txt";
    std::string utf8;
    if (!WideToUtf8(line, utf8)) return;
    AppendBounded(file, utf8);
}

static void AppendDelivery(const std::wstring& line) {
    std::wstring dir = KnownTagLauncherDir();
    if (dir.empty()) {
        AppendStatus(L"delivery_write_err=known_folder\n");
        return;
    }
    std::wstring file = dir + L"\\win11-menu-delivery.jsonl";
    std::string utf8;
    if (!WideToUtf8((line + L"\n").c_str(), utf8)) {
        AppendStatus(L"delivery_write_err=utf8\n");
        return;
    }
    DWORD err = AppendBounded(file, utf8);
    if (err) {
        wchar_t msg[80];
        wsprintfW(msg, L"delivery_write_err=%u\n", err);
        AppendStatus(msg);
    }
}

static std::wstring FindExe(const wchar_t** source = nullptr, std::wstring* trace = nullptr) {
    std::wstring dir = ModuleDir();
    struct Cand { std::wstring path; const wchar_t* src; };
    Cand cands[4];
    int n = 0;
    cands[n++] = { dir + L"\\tag-launcher.exe", L"module_same" };
    wchar_t parent[MAX_PATH * 4] = {};
    lstrcpynW(parent, dir.c_str(), ARRAYSIZE(parent));
    PathRemoveFileSpecW(parent);
    if (parent[0] != 0) cands[n++] = { std::wstring(parent) + L"\\tag-launcher.exe", L"module_parent" };
    std::wstring hostMod = ReadHostFile(dir + L"\\tl_menu.host");
    if (!hostMod.empty()) cands[n++] = { hostMod, L"host_module" };
    std::wstring known = KnownTagLauncherDir();
    if (!known.empty()) {
        std::wstring hostKnown = ReadHostFile(known + L"\\tl_menu.host");
        if (!hostKnown.empty()) cands[n++] = { hostKnown, L"host_knownfolder" };
    }
    std::wstring picked;
    const wchar_t* pickedSrc = L"";
    std::wstring tr;
    for (int i = 0; i < n; i++) {
        std::wstring resolved;
        bool exists = ExeExists(cands[i].path);
        bool ok = IsCanonicalHost(cands[i].path, resolved);
        if (!tr.empty()) tr += L" ";
        tr += cands[i].src;
        tr += ok ? L"=ok" : (exists ? L"=bad" : L"=missing");
        if (ok && picked.empty()) { picked = resolved; pickedSrc = cands[i].src; }
    }
    if (source) *source = pickedSrc;
    if (trace) *trace = tr;
    return picked;
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
        std::wstring req = ReqForLog(NewRequestId());
        DWORD il = IntegrityRid(GetCurrentProcess());
        DWORD session = 0;
        ProcessIdToSessionId(GetCurrentProcessId(), &session);
        if (!items) {
            AppendStatus((L"req=" + req + L" event=invoke items=null\n").c_str());
            AppendDelivery(L"{\"req\":\"" + req + L"\",\"event\":\"invoke\",\"items\":\"null\"}");
            return S_OK;
        }
        DWORD count = 0;
        HRESULT countHr = items->GetCount(&count);
        if (FAILED(countHr)) {
            wchar_t line[256];
            wsprintfW(line, L"req=%s event=invoke items_hr=0x%08X\n", req.c_str(), (unsigned)countHr);
            AppendStatus(line);
            return countHr;
        }
        std::wstring args = L"--tl-menu-req " + req + L" --collect";
        std::wstring marker;
        DWORD named = 0;
        std::wstring pathHashes;
        for (DWORD i = 0; i < count; ++i) {
            IShellItem* item = nullptr;
            HRESULT ihr = items->GetItemAt(i, &item);
            if (FAILED(ihr) || !item) continue;
            PWSTR path = nullptr;
            if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))) {
                args += L" \"";
                args += path;
                args += L"\"";
                marker += path;
                marker += L"\n";
                std::string h = SaltedPathHash(req, path);
                if (!pathHashes.empty()) pathHashes += L",";
                for (char c : h) pathHashes += (wchar_t)(unsigned char)c;
                named++;
                CoTaskMemFree(path);
            }
            item->Release();
        }
#ifdef TL_MENU_PROBE
        AppendMarker(marker);
#endif
        const wchar_t* src = L"";
        std::wstring trace;
        std::wstring exe = FindExe(&src, &trace);
        wchar_t head[1024];
        wsprintfW(head, L"req=%s event=invoke dllhost_pid=%u il=%u session=%u count=%u named=%u items_hr=0x%08X",
            req.c_str(), GetCurrentProcessId(), il, session, count, named, (unsigned)countHr);
        if (exe.empty()) {
            AppendStatus((std::wstring(head) + L" find_exe=0 find_trace=" + trace + L"\n").c_str());
            AppendDelivery(L"{\"req\":\"" + req + L"\",\"event\":\"invoke\",\"find_exe\":0}");
#ifdef TL_MENU_PROBE
            AppendMarker(L"find_exe=0\n");
#endif
            return E_FAIL;
        }
        std::string pathHash = SaltedPathHash(req, exe);
        std::wstring pathHashW;
        for (char c : pathHash) pathHashW += (wchar_t)(unsigned char)c;
        AppendStatus((std::wstring(head) + L" find_exe=1 find_src=" + src + L" find_trace=" + trace
            + L" exe_path_hash=" + pathHashW + L"\n").c_str());
        // 探针与产品同一条启动路径（先经 explorer，失败再直接启动），避免双启打到不同实例。
        HRESULT viaHr = ShellExecuteViaExplorer(exe, args);
        HRESULT launchHr = viaHr;
        const wchar_t* via = L"explorer";
        INT_PTR shell = 0;
        DWORD lastErr = 0;
        if (FAILED(viaHr)) {
            SetLastError(0);
            HINSTANCE r = ShellExecuteW(nullptr, L"open", exe.c_str(), args.c_str(), nullptr, SW_SHOWNORMAL);
            shell = (INT_PTR)r;
            lastErr = GetLastError();
            via = L"direct_fallback";
            if (shell <= 32) {
                // shell==0 且 LastError==0 时 HRESULT_FROM_WIN32(0) 会变成 S_OK，必须回退到失败码。
                if (lastErr != 0) launchHr = HRESULT_FROM_WIN32(lastErr);
                else if (shell != 0) launchHr = HRESULT_FROM_WIN32((DWORD)shell);
                else launchHr = HRESULT_FROM_WIN32(ERROR_GEN_FAILURE);
            } else {
                launchHr = S_OK;
            }
#ifdef TL_MENU_PROBE
            wchar_t note[80];
            wsprintfW(note, L"via=direct_fallback hr=0x%08X shell=%d last_err=%u\n", (unsigned)viaHr, (int)shell, lastErr);
            AppendMarker(note);
#endif
        } else {
#ifdef TL_MENU_PROBE
            AppendMarker(L"via=explorer\n");
#endif
        }
        wchar_t tail[320];
        wsprintfW(tail, L"req=%s event=launch via=%s via_hr=0x%08X shell=%d last_err=%u launch_hr=0x%08X\n",
            req.c_str(), via, (unsigned)viaHr, (int)shell, lastErr, (unsigned)launchHr);
        AppendStatus(tail);
        AppendDelivery(L"{\"req\":\"" + req + L"\",\"event\":\"launch\",\"via\":\"" + via
            + L"\",\"via_hr\":" + std::to_wstring((unsigned)viaHr)
            + L",\"shell\":" + std::to_wstring((int)shell)
            + L",\"last_err\":" + std::to_wstring(lastErr)
            + L",\"launch_hr\":" + std::to_wstring((unsigned)launchHr)
            + L",\"find_src\":\"" + src + L"\",\"exe_path_hash\":\"" + pathHashW + L"\"}");
        // 启动已提交不是「本实例已收到」。direct fallback 失败必须把错误传回，不能仍报 S_OK。
        return launchHr;
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

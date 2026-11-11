// CI 探针：以普通（非打包）进程激活稀疏包里的进程外 COM 类，调用 IExplorerCommand 的 GetTitle/Invoke。
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("a08ce4d0-fa25-44ab-b57c-c7b1c323e0b9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IExplorerCommand {
    [PreserveSig] int GetTitle(IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int GetIcon(IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] out string icon);
    [PreserveSig] int GetToolTip(IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] out string tip);
    [PreserveSig] int GetCanonicalName(out Guid guid);
    [PreserveSig] int GetState(IntPtr items, int okToBeSlow, out int state);
    [PreserveSig] int Invoke(IntPtr items, IntPtr bindCtx);
    [PreserveSig] int GetFlags(out int flags);
    [PreserveSig] int EnumSubCommands(out IntPtr e);
}

public static class ComProbe {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr bc, ref Guid riid, out IntPtr item);
    [DllImport("shell32.dll", PreserveSig = false)]
    static extern void SHCreateShellItemArrayFromShellItem(IntPtr item, ref Guid riid, out IntPtr array);

    public static string Run(string clsid, string path) {
        var type = Type.GetTypeFromCLSID(new Guid(clsid), true);
        var cmd = (IExplorerCommand)Activator.CreateInstance(type);
        string title;
        int hr = cmd.GetTitle(IntPtr.Zero, out title);
        Guid iidItem = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");
        Guid iidArray = new Guid("b63ea76d-1f85-456f-a19c-48159efa858b");
        IntPtr item, array;
        SHCreateItemFromParsingName(path, IntPtr.Zero, ref iidItem, out item);
        SHCreateShellItemArrayFromShellItem(item, ref iidArray, out array);
        int state;
        int hrState = cmd.GetState(array, 1, out state);
        int hrInvoke = cmd.Invoke(array, IntPtr.Zero);
        Marshal.Release(array);
        Marshal.Release(item);
        Marshal.ReleaseComObject(cmd);
        return String.Format("title={0} hrTitle=0x{1:X8} state={2} hrState=0x{3:X8} hrInvoke=0x{4:X8}", title, hr, state, hrState, hrInvoke);
    }
}

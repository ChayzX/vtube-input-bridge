using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Owned by the sender's UI thread. A message-only window stays alive in the tray.
internal sealed class RawMouseInput : NativeWindow, IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Device
    {
        public ushort UsagePage, Usage;
        public uint Flags;
        public IntPtr Target;
    }
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RegisterRawInputDevices(Device[] devices, uint count, uint size);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetRawInputData(IntPtr input, uint command, [Out] byte[] data, ref uint size, uint headerSize);

    private readonly MouseMotion motion;
    private volatile string lastError = "";
    public string LastError { get { return lastError; } }

    public RawMouseInput(MouseMotion motion)
    {
        this.motion = motion;
        CreateHandle(new CreateParams { Caption = "VTube Input Bridge Mouse", Parent = new IntPtr(-3) });
        // INPUTSINK receives movement with another app focused. No capture or
        // NOLEGACY flags: this registration must not alter the game's input.
        var device = new Device { UsagePage = 1, Usage = 2, Flags = 0x100, Target = Handle };
        if (!RegisterRawInputDevices(new[] { device }, 1, (uint)Marshal.SizeOf(typeof(Device))))
        {
            var error = new Win32Exception(Marshal.GetLastWin32Error(), "Cannot register background mouse input.");
            DestroyHandle();
            throw error;
        }
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == 0x00FF)
        {
            try
            {
                uint size = 0;
                uint headerSize = (uint)(8 + IntPtr.Size * 2);
                if (GetRawInputData(message.LParam, 0x10000003, null, ref size, headerSize) == uint.MaxValue)
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                if (size > 0 && size <= 65536)
                {
                    byte[] bytes = new byte[size];
                    uint copied = GetRawInputData(message.LParam, 0x10000003, bytes, ref size, headerSize);
                    if (copied == uint.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
                    int dx, dy;
                    if (copied == bytes.Length && RawMousePacket.TryRead(bytes, IntPtr.Size, out dx, out dy))
                        motion.AddRelative(dx, dy);
                }
            }
            catch (Exception error) { lastError = "Raw mouse capture failed: " + error.Message; }
        }
        // DefWindowProc must run for foreground WM_INPUT cleanup.
        base.WndProc(ref message);
    }

    public void Dispose()
    {
        if (Handle == IntPtr.Zero) return;
        var device = new Device { UsagePage = 1, Usage = 2, Flags = 1, Target = IntPtr.Zero };
        RegisterRawInputDevices(new[] { device }, 1, (uint)Marshal.SizeOf(typeof(Device)));
        DestroyHandle();
    }
}

using System;
using System.Windows.Forms;

// Windows-only smoke test: registration and cleanup must work on both starts.
internal static class RawMouseInputTests
{
    [STAThread]
    public static int Main()
    {
        for (int i = 0; i < 2; i++)
        {
            using (var capture = new RawMouseInput(new MouseMotion()))
            {
                Application.DoEvents();
                if (capture.LastError != "") throw new Exception(capture.LastError);
            }
        }
        Console.WriteLine("RawMouseInputTests passed (registration lifecycle; no physical movement simulated)");
        return 0;
    }
}

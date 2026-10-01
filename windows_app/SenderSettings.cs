using System;
using System.Globalization;
using System.IO;

// Sender settings shared by the windowed app and the headless helper, so both read and write the same files.
internal static class SenderSettings
{
    public const string DefaultDestination = "10.0.0.119";
    // Tests point this at a temporary folder so they never touch the real settings.
    public static string ConfigDir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "VTubeInputBridge");

    public static void LoadMouse(MouseMotion mouse)
    {
        try
        {
            string[] settings = File.ReadAllLines(Path.Combine(ConfigDir, "mouse-mode.txt"));
            if (settings.Length == 2)
            {
                double value;
                if (double.TryParse(settings[1], NumberStyles.Float, CultureInfo.InvariantCulture, out value))
                    mouse.Sensitivity = value;
                mouse.GameMode = settings[0] == "game";
            }
        }
        catch { }
    }

    public static void SaveMouse(MouseMotion mouse)
    {
        Directory.CreateDirectory(ConfigDir);
        File.WriteAllLines(Path.Combine(ConfigDir, "mouse-mode.txt"), new[] {
            mouse.GameMode ? "game" : "desktop", mouse.Sensitivity.ToString(CultureInfo.InvariantCulture) });
    }

    public static string LoadDestination()
    {
        try { string value = File.ReadAllText(Path.Combine(ConfigDir, "destination.txt")).Trim(); if (value != "") return value; }
        catch { }
        return DefaultDestination;
    }

    public static void SaveDestination(string host)
    {
        Directory.CreateDirectory(ConfigDir);
        File.WriteAllText(Path.Combine(ConfigDir, "destination.txt"), host);
    }
}

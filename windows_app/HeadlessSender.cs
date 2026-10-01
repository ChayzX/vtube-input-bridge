using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// The sender without a window or tray icon, for hosting inside the VTube Control app ("--headless").
// The host writes one command per line on stdin and reads one JSON object per line on stdout:
//   start <IPv4>             start sending (and remember the address)
//   stop                     stop sending
//   mouse <game|desktop> <n> set game mouse mode and sensitivity (0.1 to 5), saved like the windowed app
//   status                   report status now (it is also reported twice a second)
// Closing stdin (the host exiting or crashing) stops sending and exits, so a sender is never orphaned.
internal sealed class HeadlessSender : IDisposable
{
    private readonly MouseMotion mouse = new MouseMotion();
    private readonly SenderRuntime sender;
    private readonly RawMouseInput rawMouse;
    private readonly string rawMouseError = "";
    private readonly Func<bool> legacyRunning;
    private string destination;
    private long lastCaptureTicks;

    public HeadlessSender(bool captureRawMouse, Func<bool> legacyRunning)
    {
        this.legacyRunning = legacyRunning;
        if (captureRawMouse)
        {
            try { rawMouse = new RawMouseInput(mouse); }
            catch (Exception error) { rawMouseError = error.Message; }
        }
        SenderSettings.LoadMouse(mouse);
        destination = SenderSettings.LoadDestination();
        sender = new SenderRuntime(Capture);
    }

    private string RawUnavailable { get { return rawMouseError != "" ? rawMouseError : "Game mouse capture is unavailable."; } }

    private InputState Capture(InputState previous)
    {
        if (mouse.GameMode && (rawMouse == null || rawMouse.LastError != ""))
            throw new InvalidOperationException(rawMouse == null ? rawMouseError : rawMouse.LastError);
        long now = Stopwatch.GetTimestamp();
        double seconds = lastCaptureTicks == 0 ? 1.0 / 60 : (double)(now - lastCaptureTicks) / Stopwatch.Frequency;
        lastCaptureTicks = now;
        return mouse.Apply(WindowsInputCapture.Sample(previous, !mouse.GameMode), seconds);
    }

    // Runs one command line and returns an error message, or "" on success.
    public string Execute(string line)
    {
        string[] parts = (line ?? "").Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return "";
        try
        {
            switch (parts[0])
            {
                case "status": return "";
                case "stop": sender.Stop(); return "";
                case "start":
                    if (parts.Length != 2) return "Usage: start <IPv4>";
                    if (sender.IsRunning) return "";
                    if (legacyRunning()) return "The old gaming input relay is running. Disable its scheduled task first.";
                    if (mouse.GameMode && rawMouse == null) return RawUnavailable;
                    mouse.Reset();
                    lastCaptureTicks = 0;
                    sender.Start(parts[1], 5055);
                    destination = parts[1];
                    SenderSettings.SaveDestination(destination);
                    return "";
                case "mouse":
                    double value;
                    if (parts.Length != 3 || (parts[1] != "game" && parts[1] != "desktop") ||
                        !double.TryParse(parts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out value))
                        return "Usage: mouse <game|desktop> <sensitivity>";
                    if (parts[1] == "game" && rawMouse == null) return RawUnavailable;
                    mouse.Sensitivity = value;
                    mouse.GameMode = parts[1] == "game";
                    SenderSettings.SaveMouse(mouse);
                    return "";
                default: return "Unknown command: " + parts[0];
            }
        }
        catch (Exception error) { return error.Message; }
    }

    public string StatusJson()
    {
        var status = new Dictionary<string, object> {
            { "type", "status" }, { "running", sender.IsRunning }, { "packets", sender.PacketsSent },
            { "error", sender.LastError }, { "destination", destination }, { "gameMode", mouse.GameMode },
            { "sensitivity", mouse.Sensitivity }, { "rawEvents", mouse.RelativePackets },
            { "rawError", rawMouse == null ? rawMouseError : rawMouse.LastError }, { "legacy", legacyRunning() }
        };
        return new JavaScriptSerializer().Serialize(status);
    }

    public static string MessageJson(string type, string message)
    {
        return new JavaScriptSerializer().Serialize(new Dictionary<string, object> { { "type", type }, { "message", message } });
    }

    public void Dispose()
    {
        sender.Dispose();
        if (rawMouse != null) rawMouse.Dispose();
    }

    // Owns the UI thread: raw mouse input needs a message loop, and every command runs on this thread.
    public static int Run(TextReader input, TextWriter output, Func<bool> legacyRunning)
    {
        var writer = TextWriter.Synchronized(output);
        Action<string> emit = text => { try { writer.WriteLine(text); writer.Flush(); } catch (IOException) { } };
        var context = new ApplicationContext();
        var invoker = new Control();
        invoker.CreateControl();
        using (var host = new HeadlessSender(true, legacyRunning))
        {
            var timer = new System.Windows.Forms.Timer { Interval = 500 };
            timer.Tick += delegate { emit(host.StatusJson()); };
            timer.Start();
            emit(host.StatusJson());
            var reader = new Thread(() =>
            {
                string line;
                try
                {
                    while ((line = input.ReadLine()) != null)
                    {
                        string command = line;
                        invoker.BeginInvoke((Action)delegate
                        {
                            string error = host.Execute(command);
                            if (error != "") emit(MessageJson("error", error));
                            emit(host.StatusJson());
                        });
                    }
                }
                catch (IOException) { }
                try { invoker.BeginInvoke((Action)delegate { context.ExitThread(); }); } catch (InvalidOperationException) { }
            }) { IsBackground = true, Name = "VTube Input Bridge commands" };
            reader.Start();
            Application.Run(context);
            timer.Stop();
        }
        invoker.Dispose();
        return 0;
    }
}

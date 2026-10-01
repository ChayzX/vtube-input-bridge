using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

internal static class HeadlessSenderTests
{
    private static void Expect(bool condition, string message) { if (!condition) throw new Exception(message); }

    private static Dictionary<string, object> Status(HeadlessSender host)
    {
        return (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(host.StatusJson());
    }

    public static int Main()
    {
        string dir = Path.Combine(Path.GetTempPath(), "vtube-headless-test-" + Guid.NewGuid().ToString("N"));
        SenderSettings.ConfigDir = dir;
        bool legacy = false;
        try
        {
            // Raw capture is off here: tests cannot register Windows raw input.
            using (var host = new HeadlessSender(false, () => legacy))
            {
                var status = Status(host);
                Expect((string)status["type"] == "status" && !(bool)status["running"], "fresh helper should report stopped");
                Expect((string)status["destination"] == SenderSettings.DefaultDestination, "default destination missing");

                Expect(host.Execute("") == "" && host.Execute("status") == "", "blank and status lines are no-ops");
                Expect(host.Execute("dance").StartsWith("Unknown command"), "unknown command accepted");
                Expect(host.Execute("start").StartsWith("Usage"), "start without an address accepted");
                Expect(host.Execute("start not-an-ip").Contains("IPv4"), "invalid address accepted");

                legacy = true;
                Expect(host.Execute("start 127.0.0.1").Contains("old gaming input relay"), "started beside the legacy sender");
                Expect(!(bool)Status(host)["running"] && (bool)Status(host)["legacy"], "legacy sender not reported");
                legacy = false;

                Expect(host.Execute("mouse game 1") == "Game mouse capture is unavailable.", "game mode allowed without raw capture");
                Expect(!(bool)Status(host)["gameMode"], "game mode changed despite the error");
                Expect(host.Execute("mouse desktop 9").Contains("between 0.1 and 5"), "out-of-range sensitivity accepted");
                Expect(host.Execute("mouse sideways 1").StartsWith("Usage"), "unknown mouse mode accepted");

                Expect(host.Execute("mouse desktop 2.5") == "", "valid mouse setting rejected");
                Expect(Convert.ToDouble(Status(host)["sensitivity"]) == 2.5, "sensitivity not applied");
                string[] saved = File.ReadAllLines(Path.Combine(dir, "mouse-mode.txt"));
                Expect(saved.Length == 2 && saved[0] == "desktop" && saved[1] == "2.5", "mouse setting not saved like the windowed app");
                Expect(host.Execute("stop") == "", "stop while stopped should succeed");
            }

            // A new helper picks up the saved settings, as the windowed app does.
            File.WriteAllText(Path.Combine(dir, "destination.txt"), "10.0.0.50");
            using (var host = new HeadlessSender(false, () => false))
            {
                var status = Status(host);
                Expect((string)status["destination"] == "10.0.0.50", "saved destination not loaded");
                Expect(Convert.ToDouble(status["sensitivity"]) == 2.5, "saved sensitivity not loaded");
            }

            var message = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(HeadlessSender.MessageJson("error", "a \"quoted\" line"));
            Expect((string)message["type"] == "error" && (string)message["message"] == "a \"quoted\" line", "message JSON not escaped");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
        Console.WriteLine("HeadlessSenderTests passed");
        return 0;
    }
}

using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

internal static class BridgeCoreTests
{
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    public static int Main()
    {
        var state = new InputState { MouseX = 0.5f, MouseY = -0.25f, W = true, LeftClick = true,
            PressedKeys = new int[] { 0x41, 0x57 } };
        string packet = PacketCodec.Serialize(state, 42, 123456789);
        var root = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(packet);
        var input = (Dictionary<string, object>)root["state"];
        Check(Convert.ToInt32(root["version"]) == 1, "protocol version");
        Check(Convert.ToInt64(root["sequence"]) == 42, "sequence");
        Check(Convert.ToInt64(root["timestamp"]) == 123456789, "timestamp");
        Check(Convert.ToDouble(input["mouse_x"]) == 0.5, "mouse x");
        Check((bool)input["w"] && (bool)input["left_click"], "buttons");
        Check(input.ContainsKey("mouse_delta_y") && input.ContainsKey("space"), "all fields");
        var keys = (object[])input["pressed_keys"];
        Check(keys.Length == 2 && Convert.ToInt32(keys[0]) == 0x41 && Convert.ToInt32(keys[1]) == 0x57, "pressed keys");

        var status = ReceiverStatus.Parse("{\"source\":\"10.0.0.112\",\"vts_connected\":true,\"packets_received\":21,\"last_packet_unix_ms\":10000}");
        Check(status.IsReceiving(11000), "fresh receiver feed");
        Check(!status.IsReceiving(14000), "stale receiver feed");
        Check(status.Source == "10.0.0.112" && status.PacketsReceived == 21, "receiver details");
        Console.WriteLine("BridgeCoreTests passed");
        return 0;
    }
}

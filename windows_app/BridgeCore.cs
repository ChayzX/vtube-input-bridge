using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

internal sealed class InputState
{
    public float MouseX, MouseY, MouseDeltaX, MouseDeltaY;
    public bool LeftClick, RightClick, W, A, S, D, Shift, Ctrl, Space;
    public int[] PressedKeys = new int[0];
}

internal static class PacketCodec
{
    public static string Serialize(InputState state, long sequence, long timestamp)
    {
        var input = new Dictionary<string, object> {
            { "mouse_x", state.MouseX }, { "mouse_y", state.MouseY },
            { "mouse_delta_x", state.MouseDeltaX }, { "mouse_delta_y", state.MouseDeltaY },
            { "left_click", state.LeftClick }, { "right_click", state.RightClick },
            { "w", state.W }, { "a", state.A }, { "s", state.S }, { "d", state.D },
            { "shift", state.Shift }, { "ctrl", state.Ctrl }, { "space", state.Space },
            { "pressed_keys", state.PressedKeys }
        };
        var packet = new Dictionary<string, object> {
            { "version", 1 }, { "sequence", sequence }, { "timestamp", timestamp },
            { "state", input }
        };
        return new JavaScriptSerializer().Serialize(packet);
    }

    public static long UnixMillis()
    {
        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
    }
}

internal sealed class ReceiverStatus
{
    public string Source;
    public bool VtsConnected;
    public long PacketsReceived;
    public long LastPacketUnixMs;

    public static ReceiverStatus Parse(string text)
    {
        var data = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(text);
        return new ReceiverStatus {
            Source = Convert.ToString(data["source"]),
            VtsConnected = Convert.ToBoolean(data["vts_connected"]),
            PacketsReceived = Convert.ToInt64(data["packets_received"]),
            LastPacketUnixMs = Convert.ToInt64(data["last_packet_unix_ms"])
        };
    }

    public bool IsReceiving(long nowUnixMs)
    {
        long age = nowUnixMs - LastPacketUnixMs;
        return VtsConnected && PacketsReceived > 0 && age >= 0 && age <= 2500;
    }
}

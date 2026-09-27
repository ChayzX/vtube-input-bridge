using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Web.Script.Serialization;

internal static class MouseMotionTests
{
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    private static void Near(float actual, float expected, string message)
    { Check(Math.Abs(actual - expected) < 0.0001f, message + ": " + actual); }

    private static byte[] Packet(int pointerSize, uint type, ushort flags, int dx, int dy)
    {
        int header = 8 + pointerSize * 2;
        byte[] bytes = new byte[header + 24];
        Array.Copy(BitConverter.GetBytes(type), 0, bytes, 0, 4);
        Array.Copy(BitConverter.GetBytes((uint)bytes.Length), 0, bytes, 4, 4);
        Array.Copy(BitConverter.GetBytes(flags), 0, bytes, header, 2);
        Array.Copy(BitConverter.GetBytes(dx), 0, bytes, header + 12, 4);
        Array.Copy(BitConverter.GetBytes(dy), 0, bytes, header + 16, 4);
        return bytes;
    }

    public static int Main()
    {
        int dx, dy;
        foreach (int pointerSize in new[] { 4, 8 })
        {
            Check(RawMousePacket.TryRead(Packet(pointerSize, 0, 0, 100, -50), pointerSize, out dx, out dy),
                "relative raw mouse packet must decode for x86 and x64");
            Check(dx == 100 && dy == -50, "signed relative movement survives decoding");
        }
        Check(!RawMousePacket.TryRead(Packet(8, 1, 0, 100, 50), 8, out dx, out dy), "keyboard packet is not mouse motion");
        Check(!RawMousePacket.TryRead(Packet(8, 0, 1, 32000, 32000), 8, out dx, out dy), "absolute tablet data is not a relative impulse");
        Check(!RawMousePacket.TryRead(new byte[20], 8, out dx, out dy), "truncated data is rejected");

        var motion = new MouseMotion();
        motion.GameMode = true;
        motion.AddRelative(40, -20);
        motion.AddRelative(60, -30);
        var heldCursor = new InputState { MouseX = 0, MouseY = 0, W = true, LeftClick = true };
        InputState sample = motion.Apply(heldCursor, 1.0 / 60);
        Near(sample.MouseX, 0.2f, "game mouse moves even when cursor is stationary");
        Near(sample.MouseY, -0.1f, "vertical game mouse moves with physical motion");
        Check(sample.W && sample.LeftClick, "game mode preserves keys and buttons");
        Near(sample.MouseDeltaX, 0.2f, "game delta uses model output units");
        sample = motion.Apply(new InputState(), 0);
        Near(sample.MouseX, 0.2f, "raw movement is consumed once per frame");
        sample = motion.Apply(new InputState(), 1);
        Check(sample.MouseX > 0 && sample.MouseX < 0.02f, "idle game mouse returns toward center");
        motion.AddRelative(int.MaxValue, int.MinValue);
        sample = motion.Apply(new InputState(), 0.016);
        Near(sample.MouseX, 1, "large positive movement is bounded");
        Near(sample.MouseY, -1, "large negative movement is bounded");
        Check(Math.Abs(sample.MouseDeltaY) <= 2, "delta remains receiver-compatible");

        motion.GameMode = false;
        motion.AddRelative(100, 100);
        sample = motion.Apply(new InputState { MouseX = -0.7f, MouseY = 0.3f, MouseDeltaX = 0.1f }, 0.016);
        Near(sample.MouseX, -0.7f, "desktop mode keeps actual cursor position");
        Near(sample.MouseDeltaX, 0.1f, "desktop mode keeps cursor delta");
        motion.GameMode = true;
        sample = motion.Apply(new InputState(), 0.016);
        Near(sample.MouseX, 0, "switching modes discards stale motion");
        motion.Sensitivity = 2;
        motion.AddRelative(100, 0);
        sample = motion.Apply(new InputState(), 0);
        Near(sample.MouseX, 0.4f, "sensitivity scales movement");
        motion.Reset();
        sample = motion.Apply(new InputState(), 0);
        Near(sample.MouseX, 0, "starting a sender clears stopped-session motion");

        using (var listener = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0)))
        {
            listener.Client.ReceiveTimeout = 3000;
            motion.AddRelative(100, -50);
            using (var sender = new SenderRuntime(previous => motion.Apply(new InputState(), 0)))
            {
                sender.Start("127.0.0.1", ((IPEndPoint)listener.Client.LocalEndPoint).Port);
                IPEndPoint remote = null;
                var root = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(
                    Encoding.UTF8.GetString(listener.Receive(ref remote)));
                var state = (Dictionary<string, object>)root["state"];
                Near(Convert.ToSingle(state["mouse_x"]), 0.4f, "game motion reaches existing UDP mouse field");
                Near(Convert.ToSingle(state["mouse_y"]), -0.2f, "game vertical motion reaches existing UDP field");
                Check(Convert.ToInt32(root["version"]) == 1, "protocol stays compatible with Canada");
                sender.Stop();
            }
        }
        Console.WriteLine("MouseMotionTests passed");
        return 0;
    }
}

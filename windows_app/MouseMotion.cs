using System;

internal sealed class MouseMotion
{
    private readonly object gate = new object();
    private bool gameMode;
    private double sensitivity = 1;
    private double pendingX, pendingY;
    private float x, y;
    private long relativePackets;

    public bool GameMode
    {
        get { lock (gate) return gameMode; }
        set { lock (gate) { if (gameMode != value) { gameMode = value; ResetLocked(); } } }
    }
    public double Sensitivity
    {
        get { lock (gate) return sensitivity; }
        set
        {
            if (double.IsNaN(value) || double.IsInfinity(value) || value < 0.1 || value > 5)
                throw new ArgumentOutOfRangeException("value", "Sensitivity must be between 0.1 and 5.");
            lock (gate) sensitivity = value;
        }
    }
    public long RelativePackets { get { lock (gate) return relativePackets; } }

    public void AddRelative(int dx, int dy)
    {
        lock (gate)
        {
            if (dx != 0 || dy != 0) relativePackets++;
            if (!gameMode) return;
            pendingX += dx;
            pendingY += dy;
        }
    }

    public InputState Apply(InputState state, double seconds)
    {
        lock (gate)
        {
            if (!gameMode) return state;
            if (double.IsNaN(seconds) || double.IsInfinity(seconds)) seconds = 1.0 / 60;
            // Time-based decay keeps return-to-center independent of sender frame rate.
            double decay = Math.Exp(-Math.Max(0, Math.Min(5, seconds)) / 0.35);
            float nextX = Clamp(x * decay + pendingX * sensitivity / 500);
            float nextY = Clamp(y * decay + pendingY * sensitivity / 500);
            pendingX = pendingY = 0;
            state.MouseDeltaX = nextX - x;
            state.MouseDeltaY = nextY - y;
            state.MouseX = x = nextX;
            state.MouseY = y = nextY;
            return state;
        }
    }

    private static float Clamp(double value) { return (float)Math.Max(-1, Math.Min(1, value)); }
    private void ResetLocked() { pendingX = pendingY = 0; x = y = 0; }
    public void Reset() { lock (gate) ResetLocked(); }
}

internal static class RawMousePacket
{
    public static bool TryRead(byte[] bytes, int pointerSize, out int dx, out int dy)
    {
        dx = dy = 0;
        if (bytes == null || (pointerSize != 4 && pointerSize != 8)) return false;
        // RAWINPUTHEADER contains two DWORDs and two pointer-sized fields.
        int header = 8 + pointerSize * 2;
        int required = header + 24;
        if (bytes.Length < required || BitConverter.ToUInt32(bytes, 0) != 0) return false;
        uint size = BitConverter.ToUInt32(bytes, 4);
        if (size < required || size > bytes.Length) return false;
        if ((BitConverter.ToUInt16(bytes, header) & 1) != 0) return false;
        // RAWMOUSE has a 4-byte aligned button union; lLastX/Y are at 12/16.
        dx = BitConverter.ToInt32(bytes, header + 12);
        dy = BitConverter.ToInt32(bytes, header + 16);
        return true;
    }
}

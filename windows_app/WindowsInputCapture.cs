using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

internal static class WindowsInputCapture
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X, Y; }

    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);

    private static bool Key(int code) { return GetAsyncKeyState(code) < 0; }

    public static InputState Sample(InputState previous)
    {
        Point point;
        int width = GetSystemMetrics(0), height = GetSystemMetrics(1);
        if (width <= 1 || height <= 1 || !GetCursorPos(out point))
            throw new InvalidOperationException("Cannot read the Windows cursor or display size.");
        float x = Math.Max(-1f, Math.Min(1f, (float)point.X / (width - 1) * 2f - 1f));
        float y = Math.Max(-1f, Math.Min(1f, (float)point.Y / (height - 1) * 2f - 1f));
        var pressed = new List<int>();
        for (int code = 0x41; code <= 0x5A; code++) if (Key(code)) pressed.Add(code);
        for (int code = 0x30; code <= 0x39; code++) if (Key(code)) pressed.Add(code);
        for (int code = 0x60; code <= 0x69; code++) if (Key(code)) pressed.Add(code);
        foreach (int code in new int[] {
            0x08, 0x09, 0x0D, 0x14, 0x1B, 0x20, 0x2E,
            0x5B, 0x5C, 0x5D, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5,
            0x6E, 0x6F, 0xBC, 0xBE, 0xBF, 0xDC
        }) if (Key(code)) pressed.Add(code);
        return new InputState {
            MouseX = x, MouseY = y,
            MouseDeltaX = x - previous.MouseX, MouseDeltaY = y - previous.MouseY,
            LeftClick = Key(0x01), RightClick = Key(0x02),
            W = Key(0x57), A = Key(0x41), S = Key(0x53), D = Key(0x44),
            Shift = Key(0x10), Ctrl = Key(0x11), Space = Key(0x20),
            PressedKeys = pressed.ToArray()
        };
    }
}

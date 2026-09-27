using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        bool receiver = Array.IndexOf(args, "--receiver") >= 0;
        bool autoStart = Array.IndexOf(args, "--autostart") >= 0;
        bool created;
        using (var mutex = new System.Threading.Mutex(true, "Local\\VTubeInputBridge_" + (receiver ? "receiver" : "sender"), out created))
        {
            if (!created) { MessageBox.Show("VTube Input Bridge is already open for this PC.", "VTube Input Bridge"); return; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new BridgeForm(receiver, autoStart));
        }
    }
}

internal sealed class BridgeForm : Form
{
    private readonly bool receiver;
    private readonly SenderRuntime sender;
    private readonly NotifyIcon tray;
    private readonly Timer refresh;
    private readonly Label status;
    private readonly Label detail;
    private readonly Label count;
    private TextBox destination;
    private Button toggle;
    private CheckBox login;
    private bool exiting;
    private bool initializing;
    private readonly Color ink = Color.FromArgb(228, 235, 248);
    private readonly Color muted = Color.FromArgb(158, 172, 196);
    private readonly Color green = Color.FromArgb(102, 218, 158);
    private readonly Color amber = Color.FromArgb(245, 190, 97);
    private readonly string configDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "VTubeInputBridge");
    private readonly string statusPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "VTubeInputRelay", "status.json");
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunName = "VTube Input Bridge";

    public BridgeForm(bool receiver, bool autoStart)
    {
        this.receiver = receiver;
        if (!receiver) sender = new SenderRuntime(WindowsInputCapture.Sample);
        Text = receiver ? "VTube Input Bridge — Stream PC" : "VTube Input Bridge — Gaming PC";
        Width = 440; Height = receiver ? 260 : 316;
        MinimumSize = MaximumSize = Size;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        BackColor = Color.FromArgb(22, 30, 47);
        ForeColor = ink;
        Font = new Font("Segoe UI", 9.5f);
        try { Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { Icon = SystemIcons.Application; }

        AddLabel("VTUBE INPUT BRIDGE", 20, 18, 395, 23, 13f, FontStyle.Bold, ink);
        AddLabel(receiver ? "STREAM PC  •  CANADA" : "GAMING PC  •  INPUT SENDER", 20, 47, 395, 20, 8.5f, FontStyle.Bold, muted);
        status = AddLabel("Checking…", 20, 83, 395, 29, 14f, FontStyle.Bold, amber);
        detail = AddLabel("", 20, 119, 395, 43, 9f, FontStyle.Regular, muted);
        count = AddLabel("", 20, 159, 395, 22, 9f, FontStyle.Regular, muted);

        if (receiver) BuildReceiver(); else BuildSender();
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open", null, delegate { RestoreWindow(); });
        menu.Items.Add("Exit", null, delegate { exiting = true; Close(); });
        tray = new NotifyIcon { Icon = Icon, Text = "VTube Input Bridge", Visible = true, ContextMenuStrip = menu };
        tray.DoubleClick += delegate { RestoreWindow(); };
        FormClosing += OnClosing;
        refresh = new Timer { Interval = 1000 };
        refresh.Tick += delegate { UpdateStatus(); };
        refresh.Start();
        if (!receiver && autoStart) Shown += delegate { StartSender(); };
        UpdateStatus();
    }

    private Label AddLabel(string value, int x, int y, int w, int h, float size, FontStyle style, Color color)
    {
        var label = new Label { Text = value, Location = new Point(x, y), Size = new Size(w, h),
            Font = new Font("Segoe UI", size, style), ForeColor = color };
        Controls.Add(label);
        return label;
    }

    private void BuildSender()
    {
        AddLabel("Stream PC address", 20, 190, 140, 24, 9f, FontStyle.Regular, muted);
        destination = new TextBox { Location = new Point(164, 187), Width = 137, Text = LoadDestination(),
            BackColor = Color.FromArgb(39, 49, 69), ForeColor = ink, BorderStyle = BorderStyle.FixedSingle };
        Controls.Add(destination);
        toggle = new Button { Location = new Point(314, 184), Size = new Size(103, 31), Text = "Start",
            BackColor = Color.FromArgb(44, 131, 94), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
        toggle.FlatAppearance.BorderSize = 0;
        toggle.Click += delegate { if (sender.IsRunning) sender.Stop(); else StartSender(); UpdateStatus(); };
        Controls.Add(toggle);
        initializing = true;
        login = new CheckBox { Text = "Start sending when I sign in", Location = new Point(20, 235),
            Width = 300, Checked = HasLoginStart(), ForeColor = muted };
        Controls.Add(login);
        login.CheckedChanged += delegate { if (!initializing) SetLoginStart(login.Checked); };
        initializing = false;
    }

    private void BuildReceiver()
    {
        AddLabel("This window monitors the receiver. The receiver keeps running if you exit.",
            20, 194, 398, 35, 8.5f, FontStyle.Regular, muted);
    }

    private string LoadDestination()
    {
        try { string value = File.ReadAllText(Path.Combine(configDir, "destination.txt")).Trim(); if (value != "") return value; }
        catch { }
        return "10.0.0.119";
    }

    private void StartSender()
    {
        if (LegacySenderRunning()) { UpdateStatus(); return; }
        try
        {
            string host = destination.Text.Trim();
            sender.Start(host, 5055);
            Directory.CreateDirectory(configDir);
            File.WriteAllText(Path.Combine(configDir, "destination.txt"), host);
        }
        catch (Exception error) { MessageBox.Show(error.Message, "Could not start sender", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        UpdateStatus();
    }

    private static bool LegacySenderRunning()
    {
        try { return Process.GetProcessesByName("gaming_input_relay").Length > 0; }
        catch { return false; }
    }

    private bool HasLoginStart()
    {
        try { using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey)) return key != null && key.GetValue(RunName) != null; }
        catch { return false; }
    }

    private void SetLoginStart(bool enabled)
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (enabled) key.SetValue(RunName, "\"" + Assembly.GetExecutingAssembly().Location + "\" --sender --autostart");
                else key.DeleteValue(RunName, false);
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Could not change sign-in setting");
            initializing = true;
            login.Checked = !enabled;
            initializing = false;
        }
    }

    private void UpdateStatus()
    {
        if (receiver) UpdateReceiverStatus(); else UpdateSenderStatus();
        tray.Text = "VTube Input Bridge: " + status.Text.Substring(0, Math.Min(status.Text.Length, 35));
    }

    private void UpdateSenderStatus()
    {
        bool legacy = LegacySenderRunning();
        toggle.Enabled = !legacy || sender.IsRunning;
        toggle.Text = sender.IsRunning ? "Stop" : "Start";
        destination.Enabled = !sender.IsRunning;
        if (legacy)
        {
            status.Text = "Old sender is running"; status.ForeColor = amber;
            detail.Text = "Disable the old gaming input relay task before starting this app.";
            count.Text = "This prevents two senders from sending at once.";
        }
        else if (sender.IsRunning)
        {
            status.Text = "Sending input"; status.ForeColor = green;
            detail.Text = "To stream PC " + destination.Text.Trim() + " on UDP 5055.";
            count.Text = sender.PacketsSent.ToString("N0") + " packets sent. Receiver confirmation is shown on the stream PC.";
        }
        else
        {
            status.Text = sender.LastError == "" ? "Sender stopped" : "Sender stopped: error";
            status.ForeColor = amber;
            detail.Text = sender.LastError == "" ? "Choose the stream PC address and press Start." : sender.LastError;
            count.Text = "";
        }
    }

    private void UpdateReceiverStatus()
    {
        bool process;
        try { process = Process.GetProcessesByName("vts_input_relay").Length > 0; }
        catch { process = false; }
        ReceiverStatus state = null;
        try { state = ReceiverStatus.Parse(File.ReadAllText(statusPath)); }
        catch { }
        if (!process)
        {
            status.Text = "Receiver stopped"; status.ForeColor = amber;
            detail.Text = "The VTube Input Relay background task is not running.";
            count.Text = "";
        }
        else if (state == null)
        {
            status.Text = "Receiver running"; status.ForeColor = amber;
            detail.Text = "Waiting for status from the background receiver.";
            count.Text = "";
        }
        else if (!state.VtsConnected)
        {
            status.Text = "Waiting for VTube Studio"; status.ForeColor = amber;
            detail.Text = "Receiver is running. Open VTube Studio and enable its API.";
            count.Text = "Allowed gaming PC: " + state.Source;
        }
        else if (state.IsReceiving(PacketCodec.UnixMillis()))
        {
            status.Text = "Receiving input"; status.ForeColor = green;
            detail.Text = "Connected to VTube Studio; recent input arrived from " + state.Source + ".";
            count.Text = state.PacketsReceived.ToString("N0") + " packets applied.";
        }
        else
        {
            status.Text = "Waiting for gaming PC"; status.ForeColor = amber;
            detail.Text = "VTube Studio is connected. No recent input from " + state.Source + ".";
            count.Text = state.PacketsReceived.ToString("N0") + " packets applied previously.";
        }
    }

    private void RestoreWindow() { Show(); WindowState = FormWindowState.Normal; ShowInTaskbar = true; Activate(); }

    private void OnClosing(object senderObject, FormClosingEventArgs args)
    {
        if (!exiting && args.CloseReason == CloseReason.UserClosing)
        {
            args.Cancel = true; Hide(); ShowInTaskbar = false;
            return;
        }
        refresh.Stop();
        tray.Visible = false;
        tray.Dispose();
        if (sender != null) sender.Dispose();
    }
}

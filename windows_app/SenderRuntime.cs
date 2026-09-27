using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

internal sealed class SenderRuntime : IDisposable
{
    private readonly Func<InputState, InputState> capture;
    private readonly object gate = new object();
    private UdpClient socket;
    private IPEndPoint destination;
    private Timer timer;
    private InputState previous = new InputState();
    private long sequence;
    private long packetsSent;
    private string lastError = "";

    public SenderRuntime(Func<InputState, InputState> capture) { this.capture = capture; }

    public bool IsRunning { get { lock (gate) return timer != null; } }
    public long PacketsSent { get { lock (gate) return packetsSent; } }
    public string LastError { get { lock (gate) return lastError; } }

    public void Start(string host, int port)
    {
        IPAddress address;
        if (!IPAddress.TryParse(host, out address) || address.AddressFamily != AddressFamily.InterNetwork)
            throw new ArgumentException("Enter the stream PC's IPv4 address.");
        if (port < 1 || port > 65535) throw new ArgumentOutOfRangeException("port");
        lock (gate)
        {
            if (timer != null) throw new InvalidOperationException("Sender is already running.");
            destination = new IPEndPoint(address, port);
            socket = new UdpClient(AddressFamily.InterNetwork);
            previous = new InputState();
            sequence = 0;
            packetsSent = 0;
            lastError = "";
            timer = new Timer(Tick, null, 0, 16);
        }
    }

    private void Tick(object unused)
    {
        lock (gate)
        {
            if (timer == null) return;
            try
            {
                InputState state = capture(previous);
                byte[] data = Encoding.UTF8.GetBytes(PacketCodec.Serialize(state, sequence++, PacketCodec.UnixMillis()));
                socket.Send(data, data.Length, destination);
                previous = state;
                packetsSent++;
            }
            catch (Exception error)
            {
                lastError = error.Message;
                StopLocked();
            }
        }
    }

    public void Stop() { lock (gate) StopLocked(); }

    private void StopLocked()
    {
        Timer oldTimer = timer;
        timer = null;
        if (oldTimer != null) oldTimer.Dispose();
        if (socket != null) { socket.Close(); socket = null; }
    }

    public void Dispose() { Stop(); }
}

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

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
    private long bytesSent;
    private long lastAckSequence = -1;
    private long lastAckUnixMs;
    private string lastError = "";

    public SenderRuntime(Func<InputState, InputState> capture) { this.capture = capture; }

    public bool IsRunning { get { lock (gate) return timer != null; } }
    public long PacketsSent { get { lock (gate) return packetsSent; } }
    public long BytesSent { get { lock (gate) return bytesSent; } }
    public string LastError { get { lock (gate) return lastError; } }
    public long LastAckSequence { get { lock (gate) return lastAckSequence; } }
    public long LastAckUnixMs { get { lock (gate) return lastAckUnixMs; } }
    public bool ReceiverConnected { get { lock (gate) { long age = UnixMillis() - lastAckUnixMs; return timer != null && lastAckUnixMs > 0 && age >= 0 && age <= 2500; } } }

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
            socket = new UdpClient(new IPEndPoint(IPAddress.Any, 0));
            previous = new InputState();
            sequence = 0;
            packetsSent = 0;
            bytesSent = 0;
            lastAckSequence = -1;
            lastAckUnixMs = 0;
            lastError = "";
            BeginReceive(socket);
            timer = new Timer(Tick, null, 0, 16);
        }
    }

    private void BeginReceive(UdpClient current)
    {
        try { current.BeginReceive(ReceiveAcknowledgement, current); }
        catch (ObjectDisposedException) { }
        catch (Exception error)
        {
            lock (gate) if (Object.ReferenceEquals(socket, current)) lastError = error.Message;
        }
    }

    private void ReceiveAcknowledgement(IAsyncResult result)
    {
        UdpClient current = (UdpClient)result.AsyncState;
        IPEndPoint remote = new IPEndPoint(IPAddress.Any, 0);
        byte[] bytes;
        try { bytes = current.EndReceive(result, ref remote); }
        catch (ObjectDisposedException) { return; }
        catch (Exception error)
        {
            lock (gate) if (Object.ReferenceEquals(socket, current)) lastError = error.Message;
            BeginReceive(current);
            return;
        }

        try
        {
            var ack = new JavaScriptSerializer().DeserializeObject(Encoding.UTF8.GetString(bytes)) as Dictionary<string, object>;
            object rawSequence;
            if (ack != null && ack.ContainsKey("type") && Convert.ToString(ack["type"]) == "ack" &&
                ack.ContainsKey("version") && Convert.ToInt32(ack["version"], CultureInfo.InvariantCulture) == 1 &&
                ack.TryGetValue("sequence", out rawSequence))
            {
                long acknowledged = Convert.ToInt64(rawSequence, CultureInfo.InvariantCulture);
                lock (gate)
                {
                    if (Object.ReferenceEquals(socket, current) && destination != null &&
                        remote.Address.Equals(destination.Address) && remote.Port == destination.Port &&
                        acknowledged >= 0 && acknowledged < sequence && acknowledged > lastAckSequence)
                    {
                        lastAckSequence = acknowledged;
                        lastAckUnixMs = UnixMillis();
                    }
                }
            }
        }
        catch (Exception) { }
        BeginReceive(current);
    }

    private static long UnixMillis()
    {
        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
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
                bytesSent += data.Length;
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

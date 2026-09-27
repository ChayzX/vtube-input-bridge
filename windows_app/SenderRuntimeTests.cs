using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Web.Script.Serialization;

internal static class SenderRuntimeTests
{
    public static int Main()
    {
        using (var listener = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0)))
        {
            listener.Client.ReceiveTimeout = 3000;
            int port = ((IPEndPoint)listener.Client.LocalEndPoint).Port;
            using (var sender = new SenderRuntime(previous => new InputState { MouseX = 0.25f, W = true }))
            {
                sender.Start("127.0.0.1", port);
                IPEndPoint remote = null;
                byte[] bytes = listener.Receive(ref remote);
                var root = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(Encoding.UTF8.GetString(bytes));
                var state = (Dictionary<string, object>)root["state"];
                if (Convert.ToDouble(state["mouse_x"]) != 0.25 || !(bool)state["w"])
                    throw new Exception("sender did not transmit captured input");
                sender.Stop();
                if (sender.IsRunning) throw new Exception("sender failed to stop");
            }
        }
        Console.WriteLine("SenderRuntimeTests passed");
        return 0;
    }
}

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use shared::{InputState, Packet};
use std::collections::{BTreeMap, BTreeSet};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use std::time::{Duration, Instant};
use tokio::net::{TcpStream, UdpSocket};
use tokio::time::{sleep, timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

type Error = Box<dyn std::error::Error + Send + Sync>;
type VtsSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct Config {
    source: IpAddr,
    bind: SocketAddr,
    vts_url: String,
    token_file: PathBuf,
    status_file: PathBuf,
}

impl Config {
    fn parse<I, S>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut args = args.into_iter().skip(1);
        let mut source = None;
        let mut bind = "0.0.0.0:5055".parse().unwrap();
        let mut vts_url = "ws://127.0.0.1:8001".to_string();
        let mut token_file = default_token_file();
        let mut status_file = None;
        while let Some(arg) = args.next() {
            match arg.as_ref() {
                "--source" => source = Some(args.next().ok_or("missing source")?.as_ref().parse().map_err(|_| "invalid source IP")?),
                "--bind" => bind = args.next().ok_or("missing bind address")?.as_ref().parse().map_err(|_| "invalid bind address")?,
                "--vts-url" => vts_url = args.next().ok_or("missing VTS URL")?.as_ref().to_string(),
                "--token-file" => token_file = args.next().ok_or("missing token file")?.as_ref().into(),
                "--status-file" => status_file = Some(args.next().ok_or("missing status file")?.as_ref().into()),
                other => return Err(format!("unknown option: {other}")),
            }
        }
        let source = source.ok_or("usage: vts_input_relay --source <gaming PC IP> [--bind 0.0.0.0:5055] [--vts-url ws://127.0.0.1:8001]")?;
        if !vts_url.starts_with("ws://127.0.0.1:") && !vts_url.starts_with("ws://localhost:") {
            return Err("VTube Studio API must be on local loopback".into());
        }
        let status_file = status_file.unwrap_or_else(|| token_file.with_file_name("status.json"));
        Ok(Self { source, bind, vts_url, token_file, status_file })
    }
}

fn default_token_file() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("XDG_STATE_HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("VTubeInputRelay").join("vts-token.txt")
}

struct StatusReporter {
    path: Option<PathBuf>,
    source: IpAddr,
    vts_connected: bool,
    packets_received: u64,
    last_packet_unix_ms: u64,
    last_write: Instant,
}

impl StatusReporter {
    fn new(path: Option<PathBuf>, source: IpAddr) -> Self {
        Self {
            path, source, vts_connected: false, packets_received: 0,
            last_packet_unix_ms: 0,
            last_write: Instant::now() - Duration::from_secs(2),
        }
    }

    fn to_json(&self) -> String {
        json!({
            "source": self.source.to_string(),
            "vts_connected": self.vts_connected,
            "packets_received": self.packets_received,
            "last_packet_unix_ms": self.last_packet_unix_ms,
        }).to_string()
    }

    fn write(&mut self) {
        if let Some(path) = &self.path {
            if let Err(error) = std::fs::write(path, self.to_json()) {
                tracing::warn!(%error, file = %path.display(), "cannot write relay status");
            }
        }
        self.last_write = Instant::now();
    }

    fn set_connected(&mut self, connected: bool) {
        self.vts_connected = connected;
        self.write();
    }

    fn record_packet(&mut self) {
        self.packets_received = self.packets_received.saturating_add(1);
        self.last_packet_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        if self.last_write.elapsed() >= Duration::from_secs(1) {
            self.write();
        }
    }
}

struct PacketFilter {
    source: IpAddr,
    last_sequence: Option<u64>,
    last_received: Option<Instant>,
}

impl PacketFilter {
    fn new(source: IpAddr) -> Self {
        Self { source, last_sequence: None, last_received: None }
    }

    fn accept(&mut self, packet: &Packet, sender: SocketAddr) -> bool {
        if sender.ip() != self.source || packet.version != 1 || !valid_state(&packet.state) {
            return false;
        }
        let now = Instant::now();
        if let (Some(sequence), Some(received)) = (self.last_sequence, self.last_received) {
            if now.duration_since(received) < Duration::from_secs(2) && packet.sequence <= sequence {
                return false;
            }
        }
        self.last_sequence = Some(packet.sequence);
        self.last_received = Some(now);
        true
    }
}

fn valid_state(state: &InputState) -> bool {
    [state.mouse_x, state.mouse_y].iter().all(|v| v.is_finite() && (-1.0..=1.0).contains(v))
        && [state.mouse_delta_x, state.mouse_delta_y].iter().all(|v| v.is_finite() && (-2.0..=2.0).contains(v))
}

const PARAMETERS: [(&str, f32, f32); 13] = [
    ("GameMouseX", -1.0, 1.0), ("GameMouseY", -1.0, 1.0),
    ("GameMouseDX", -2.0, 2.0), ("GameMouseDY", -2.0, 2.0),
    ("GameMouseLeft", 0.0, 1.0), ("GameMouseRight", 0.0, 1.0),
    ("GameKeyW", 0.0, 1.0), ("GameKeyA", 0.0, 1.0),
    ("GameKeyS", 0.0, 1.0), ("GameKeyD", 0.0, 1.0),
    ("GameKeyShift", 0.0, 1.0), ("GameKeyCtrl", 0.0, 1.0),
    ("GameKeySpace", 0.0, 1.0),
];

fn parameter_values(input: &InputState) -> Vec<Value> {
    let values = [
        input.mouse_x, input.mouse_y, input.mouse_delta_x, input.mouse_delta_y,
        input.left_click as u8 as f32, input.right_click as u8 as f32,
        input.w as u8 as f32, input.a as u8 as f32,
        input.s as u8 as f32, input.d as u8 as f32,
        input.shift as u8 as f32, input.ctrl as u8 as f32, input.space as u8 as f32,
    ];
    let mut mapped: Vec<_> = PARAMETERS.iter().zip(values)
        .map(|((name, _, _), value)| json!({"id": name, "value": value})).collect();
    // Existing VTS models commonly map these built-in mouse inputs to motion.
    mapped.push(json!({"id": "MousePositionX", "value": input.mouse_x}));
    mapped.push(json!({"id": "MousePositionY", "value": input.mouse_y}));
    mapped
}

fn expression_for_key(key: u8) -> Option<String> {
    match key {
        0x41..=0x5A => Some(format!("{}.exp3.json", (key as char).to_ascii_lowercase())),
        0x30..=0x39 => Some(format!("{}.exp3.json", key - 0x30)),
        0x60..=0x69 => Some(format!("{}.exp3.json", key - 0x60)),
        _ => Some(match key {
            0x08 | 0x2E => "BACKSPACE.exp3.json",
            0x09 => "TAB.exp3.json",
            0x0D => "ENTER.exp3.json",
            0x14 => "CAPS.exp3.json",
            0x1B => "ESC.exp3.json",
            0x20 => "SPACE.exp3.json",
            0x5B | 0x5C => "WINDOWS.exp3.json",
            0x5D => "SYMBOL.exp3.json",
            0xA0 => "LSHIFT.exp3.json",
            0xA1 => "RSHIFT.exp3.json",
            0xA2 => "LCTRL.exp3.json",
            0xA3 => "RCTRL.exp3.json",
            0xA4 => "ALTL.exp3.json",
            0xA5 => "ALTR.exp3.json",
            0xBC | 0xBE | 0x6E => ",..exp3.json",
            0xBF | 0x6F => "FORWARD SLASH.exp3.json",
            0xDC => "[{ ]}.exp3.json",
            _ => return None,
        }.to_string()),
    }
}

fn desired_expressions(input: &InputState) -> BTreeSet<String> {
    let mut desired = BTreeSet::new();
    if let Some(keys) = &input.pressed_keys {
        for &key in keys.iter().take(80) {
            if let Some(file) = expression_for_key(key) { desired.insert(file); }
        }
    } else {
        for (held, key) in [
            (input.w, 0x57), (input.a, 0x41), (input.s, 0x53), (input.d, 0x44),
            (input.shift, 0xA0), (input.ctrl, 0xA2), (input.space, 0x20),
        ] {
            if held { desired.insert(expression_for_key(key).unwrap()); }
        }
    }
    if input.left_click { desired.insert("LEFT CLICK.exp3.json".to_string()); }
    if input.right_click { desired.insert("RIGHT CLICK.exp3.json".to_string()); }
    desired
}

fn expression_key(file: &str) -> String {
    file.strip_suffix(".exp3.json").unwrap_or(file)
        .chars().filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase).collect()
}

#[derive(Default)]
struct ExpressionBridge {
    active: BTreeSet<String>,
    previous_desired: BTreeSet<String>,
    model_id: String,
    last_check: Option<Instant>,
}

impl ExpressionBridge {
    async fn apply(&mut self, socket: &mut VtsSocket, desired: BTreeSet<String>) -> Result<(), Error> {
        if desired == self.previous_desired && (desired.is_empty() ||
            self.last_check.is_some_and(|last| last.elapsed() < Duration::from_secs(2))) {
            return Ok(());
        }
        let state = vts_request(socket, request("ExpressionStateRequest", json!({"details": false})), Duration::from_secs(5)).await?;
        let current_model = state["data"]["modelID"].as_str().unwrap_or("");
        if self.model_id != current_model {
            self.active.clear();
            self.model_id = current_model.to_string();
        }
        self.last_check = Some(Instant::now());
        let mut available = BTreeMap::new();
        if let Some(list) = state["data"]["expressions"].as_array() {
            for item in list {
                if let Some(file) = item["file"].as_str() {
                    available.insert(expression_key(file), (file.to_string(), item["active"] == true));
                }
            }
        }
        let wanted: BTreeSet<String> = desired.iter()
            .filter_map(|file| available.get(&expression_key(file)).map(|(actual, _)| actual.clone()))
            .collect();
        self.active.retain(|file| available.get(&expression_key(file)).is_some_and(|(_, active)| *active));
        let released: Vec<_> = self.active.difference(&wanted).cloned().collect();
        for file in released {
            self.set(socket, &file, false).await?;
            self.active.remove(&file);
        }
        let pressed: Vec<_> = wanted.difference(&self.active).cloned().collect();
        for file in pressed {
            self.set(socket, &file, true).await?;
            self.active.insert(file);
        }
        self.previous_desired = desired;
        Ok(())
    }

    async fn set(&self, socket: &mut VtsSocket, file: &str, active: bool) -> Result<(), Error> {
        vts_request(socket, request("ExpressionActivationRequest", json!({
            "expressionFile": file, "fadeTime": 0.01, "active": active,
        })), Duration::from_secs(5)).await?;
        Ok(())
    }
}

fn request(message_type: &str, data: Value) -> Value {
    json!({"apiName": "VTubeStudioPublicAPI", "apiVersion": "1.0", "requestID": message_type, "messageType": message_type, "data": data})
}

fn inject_request(input: &InputState) -> Value {
    request("InjectParameterDataRequest", json!({"faceFound": false, "mode": "set", "parameterValues": parameter_values(input)}))
}

async fn vts_request(socket: &mut VtsSocket, request: Value, wait: Duration) -> Result<Value, Error> {
    let kind = request["messageType"].as_str().unwrap_or("request").to_string();
    socket.send(Message::Text(request.to_string().into())).await?;
    loop {
        let item = timeout(wait, socket.next()).await.map_err(|_| format!("VTS timed out on {kind}"))?
            .ok_or("VTS disconnected")??;
        if let Message::Text(text) = item {
            let response: Value = serde_json::from_str(&text)?;
            if response["messageType"] == "APIError" {
                return Err(format!("VTS {kind}: {}", response["data"]["message"]).into());
            }
            if response["requestID"] == kind {
                return Ok(response);
            }
        }
    }
}

async fn authenticate(socket: &mut VtsSocket, path: &PathBuf) -> Result<(), Error> {
    const NAME: &str = "Game Input Relay";
    const DEVELOPER: &str = "ChayzX";
    let mut token = std::fs::read_to_string(path).unwrap_or_default().trim().to_string();
    if !token.is_empty() {
        let response = vts_request(socket, request("AuthenticationRequest", json!({"pluginName": NAME, "pluginDeveloper": DEVELOPER, "authenticationToken": token})), Duration::from_secs(5)).await?;
        if response["data"]["authenticated"] == true { return Ok(()); }
        token.clear();
    }
    tracing::info!("approve Game Input Relay in VTube Studio");
    let response = vts_request(socket, request("AuthenticationTokenRequest", json!({"pluginName": NAME, "pluginDeveloper": DEVELOPER})), Duration::from_secs(90)).await?;
    token = response["data"]["authenticationToken"].as_str().ok_or("VTS did not return a token")?.to_string();
    let response = vts_request(socket, request("AuthenticationRequest", json!({"pluginName": NAME, "pluginDeveloper": DEVELOPER, "authenticationToken": token})), Duration::from_secs(5)).await?;
    if response["data"]["authenticated"] != true { return Err("VTS rejected authentication".into()); }
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
    std::fs::write(path, token)?;
    Ok(())
}

async fn create_parameters(socket: &mut VtsSocket) -> Result<(), Error> {
    for (name, min, max) in PARAMETERS {
        vts_request(socket, request("ParameterCreationRequest", json!({"parameterName": name, "explanation": "Gaming PC input from Game Input Relay", "min": min, "max": max, "defaultValue": 0.0})), Duration::from_secs(5)).await?;
    }
    Ok(())
}

async fn relay(socket: &mut VtsSocket, udp: &UdpSocket, filter: &mut PacketFilter,
    status: &mut StatusReporter, expressions: &mut ExpressionBridge) -> Result<(), Error> {
    let mut buffer = [0_u8; 4096];
    loop {
        let (size, sender) = match timeout(Duration::from_secs(2), udp.recv_from(&mut buffer)).await {
            Ok(result) => result?,
            Err(_) => {
                expressions.apply(socket, BTreeSet::new()).await?;
                continue;
            },
        };
        let packet: Packet = match serde_json::from_slice(&buffer[..size]) {
            Ok(packet) => packet,
            Err(_) => continue,
        };
        if !filter.accept(&packet, sender) { continue; }
        vts_request(socket, inject_request(&packet.state), Duration::from_secs(3)).await?;
        expressions.apply(socket, desired_expressions(&packet.state)).await?;
        status.record_packet();
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt::init();
    let config = Config::parse(std::env::args()).map_err(|message| {
        eprintln!("{message}");
        std::io::Error::new(std::io::ErrorKind::InvalidInput, message)
    })?;
    let udp = UdpSocket::bind(config.bind).await?;
    let mut filter = PacketFilter::new(config.source);
    let mut status = StatusReporter::new(Some(config.status_file.clone()), config.source);
    let mut expressions = ExpressionBridge::default();
    status.set_connected(false);
    tracing::info!(source = %config.source, bind = %config.bind, "listening for gaming input");
    loop {
        match connect_async(&config.vts_url).await {
            Ok((mut socket, _)) => {
                let result = async {
                    authenticate(&mut socket, &config.token_file).await?;
                    create_parameters(&mut socket).await?;
                    if !expressions.active.is_empty() {
                        if let Err(error) = expressions.apply(&mut socket, BTreeSet::new()).await {
                            tracing::warn!(%error, "could not release expressions after reconnect");
                            expressions.active.clear();
                        }
                    }
                    expressions.previous_desired.clear();
                    status.set_connected(true);
                    tracing::info!("connected to VTube Studio; map Game* inputs in your model");
                    relay(&mut socket, &udp, &mut filter, &mut status, &mut expressions).await
                }.await;
                if let Err(error) = result { tracing::warn!(%error, "VTube Studio session ended"); }
                status.set_connected(false);
            }
            Err(error) => tracing::warn!(%error, "cannot connect to VTube Studio"),
        }
        sleep(Duration::from_secs(3)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, SocketAddr};

    #[test]
    fn rejects_unexpected_source_and_reordered_packet() {
        let expected = IpAddr::V4(Ipv4Addr::new(100, 1, 2, 3));
        let mut filter = PacketFilter::new(expected);
        let packet = Packet::new(InputState::default(), 7);
        assert!(!filter.accept(&packet, SocketAddr::from(([100, 1, 2, 4], 4000))));
        assert!(filter.accept(&packet, SocketAddr::from(([100, 1, 2, 3], 4000))));
        assert!(!filter.accept(&packet, SocketAddr::from(([100, 1, 2, 3], 4000))));
    }

    #[test]
    fn maps_input_to_custom_parameters() {
        let input = InputState { mouse_x: 0.25, mouse_y: -0.5, w: true, ..Default::default() };
        let values = parameter_values(&input);
        assert!(values.iter().any(|v| v["id"] == "GameMouseX" && v["value"] == 0.25));
        assert!(values.iter().any(|v| v["id"] == "MousePositionX" && v["value"] == 0.25));
        assert!(values.iter().any(|v| v["id"] == "MousePositionY" && v["value"] == -0.5));
        assert!(values.iter().any(|v| v["id"] == "GameKeyW" && v["value"] == 1.0));
        assert!(values.iter().any(|v| v["id"] == "GameKeyA" && v["value"] == 0.0));
    }

    #[test]
    fn injection_uses_vts_request_shape() {
        let request = inject_request(&InputState::default());
        assert_eq!(request["messageType"], "InjectParameterDataRequest");
        assert_eq!(request["data"]["mode"], "set");
        assert_eq!(request["data"]["parameterValues"].as_array().unwrap().len(), 15);
    }

    #[test]
    fn maps_full_and_legacy_keys_to_model_expressions() {
        let full = InputState {
            pressed_keys: Some(vec![0x57, 0x41, 0x31, 0x20, 0xA1, 0xDC]),
            left_click: true, right_click: true,
            ..Default::default()
        };
        let expressions = desired_expressions(&full);
        for name in ["w.exp3.json", "a.exp3.json", "1.exp3.json", "SPACE.exp3.json",
            "RSHIFT.exp3.json", "[{ ]}.exp3.json", "LEFT CLICK.exp3.json", "RIGHT CLICK.exp3.json"] {
            assert!(expressions.contains(name), "missing {name}");
        }
        let legacy = InputState { w: true, ctrl: true, ..Default::default() };
        let expressions = desired_expressions(&legacy);
        assert!(expressions.contains("w.exp3.json"));
        assert!(expressions.contains("LCTRL.exp3.json"));
    }

    #[test]
    fn expression_names_match_without_case_or_spacing() {
        assert_eq!(expression_key("LEFT CLICK.exp3.json"), expression_key("left_click.exp3.json"));
        assert_eq!(expression_key("W.exp3.json"), expression_key("w.exp3.json"));
    }

    #[test]
    fn packet_keeps_full_keyboard_optional_for_existing_senders() {
        let legacy = Packet::new(InputState::default(), 1);
        let encoded = serde_json::to_value(&legacy).unwrap();
        assert!(encoded["state"].get("pressed_keys").is_none());
        let decoded: Packet = serde_json::from_value(encoded).unwrap();
        assert!(decoded.state.pressed_keys.is_none());

        let full = Packet::new(InputState {
            pressed_keys: Some(vec![0x57, 0x31]), ..Default::default()
        }, 2);
        let encoded = serde_json::to_value(&full).unwrap();
        assert_eq!(encoded["state"]["pressed_keys"], json!([0x57, 0x31]));
    }

    #[tokio::test]
    async fn expression_bridge_activates_once_and_releases_on_key_up() {
        use tokio::net::TcpListener;
        use tokio_tungstenite::accept_async;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            for (index, (kind, active)) in [
                ("ExpressionStateRequest", None), ("ExpressionActivationRequest", Some(true)),
                ("ExpressionStateRequest", None), ("ExpressionActivationRequest", Some(false)),
            ].into_iter().enumerate() {
                let message = socket.next().await.unwrap().unwrap().into_text().unwrap();
                let request: Value = serde_json::from_str(&message).unwrap();
                assert_eq!(request["messageType"], kind);
                if let Some(active) = active {
                    assert_eq!(request["data"]["expressionFile"], "W.exp3.json");
                    assert_eq!(request["data"]["active"], active);
                }
                let data = if active.is_none() {
                    json!({"modelID": "an-arbitrary-model-id", "expressions": [
                        {"file": "W.exp3.json", "active": index == 2}
                    ]})
                } else { json!({}) };
                socket.send(Message::Text(json!({
                    "requestID": kind, "messageType": kind.replace("Request", "Response"), "data": data,
                }).to_string().into())).await.unwrap();
            }
        });
        let (mut socket, _) = connect_async(format!("ws://127.0.0.1:{port}")).await.unwrap();
        let mut bridge = ExpressionBridge::default();
        let pressed = BTreeSet::from(["w.exp3.json".to_string()]);
        bridge.apply(&mut socket, pressed.clone()).await.unwrap();
        bridge.apply(&mut socket, pressed).await.unwrap();
        bridge.apply(&mut socket, BTreeSet::new()).await.unwrap();
        timeout(Duration::from_secs(3), server).await.unwrap().unwrap();
        assert!(bridge.active.is_empty());
    }

    #[test]
    fn status_reports_receiver_connection_and_packet_time() {
        let mut status = StatusReporter::new(None, "10.0.0.112".parse().unwrap());
        status.set_connected(true);
        status.record_packet();
        let data: Value = serde_json::from_str(&status.to_json()).unwrap();
        assert_eq!(data["vts_connected"], true);
        assert_eq!(data["source"], "10.0.0.112");
        assert_eq!(data["packets_received"], 1);
        assert!(data["last_packet_unix_ms"].as_u64().unwrap() > 0);
    }

    #[tokio::test]
    async fn udp_packet_reaches_vts_websocket() {
        use tokio::net::TcpListener;
        use tokio_tungstenite::accept_async;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let web_port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut websocket = accept_async(stream).await.unwrap();
            let message = websocket.next().await.unwrap().unwrap().into_text().unwrap();
            let request: Value = serde_json::from_str(&message).unwrap();
            assert_eq!(request["messageType"], "InjectParameterDataRequest");
            assert_eq!(request["data"]["parameterValues"][0]["value"], 0.5);
            websocket.send(Message::Text(json!({"requestID": "InjectParameterDataRequest", "messageType": "InjectParameterDataResponse", "data": {}}).to_string().into())).await.unwrap();
        });
        let (websocket, _) = connect_async(format!("ws://127.0.0.1:{web_port}")).await.unwrap();
        let udp = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let udp_addr = udp.local_addr().unwrap();
        let sender = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let mut filter = PacketFilter::new("127.0.0.1".parse().unwrap());
        let mut status = StatusReporter::new(None, "127.0.0.1".parse().unwrap());
        let mut expressions = ExpressionBridge::default();
        let relay_task = tokio::spawn(async move {
            let mut websocket = websocket;
            relay(&mut websocket, &udp, &mut filter, &mut status, &mut expressions).await
        });
        let packet = Packet::new(InputState { mouse_x: 0.5, ..Default::default() }, 1);
        sender.send_to(&serde_json::to_vec(&packet).unwrap(), udp_addr).await.unwrap();
        timeout(Duration::from_secs(3), server).await.unwrap().unwrap();
        relay_task.abort();
    }
}

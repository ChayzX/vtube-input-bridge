use shared::{InputState, Packet};
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug)]
struct Config {
    destination: String,
    port: u16,
    rate_hz: u32,
    simulate: bool,
}

impl Config {
    fn parse<I, S>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut args = args.into_iter().skip(1);
        let mut config = Self {
            destination: String::new(),
            port: 5055,
            rate_hz: 60,
            simulate: false,
        };
        while let Some(arg) = args.next() {
            match arg.as_ref() {
                "--destination" => config.destination = args.next().ok_or("missing destination")?.as_ref().to_string(),
                "--port" => config.port = args.next().ok_or("missing port")?.as_ref().parse().map_err(|_| "invalid port")?,
                "--rate" => config.rate_hz = args.next().ok_or("missing rate")?.as_ref().parse().map_err(|_| "invalid rate")?,
                "--simulate" => config.simulate = true,
                other => return Err(format!("unknown option: {other}")),
            }
        }
        if config.destination.is_empty() || config.port == 0 || !(1..=120).contains(&config.rate_hz) {
            return Err("usage: gaming_input_relay --destination <Canada IP> [--port 5055] [--rate 60] [--simulate]".into());
        }
        #[cfg(not(target_os = "windows"))]
        if !config.simulate {
            return Err("real input capture requires Windows; use --simulate for a test feed".into());
        }
        Ok(config)
    }

    fn socket_addr(&self) -> Result<SocketAddr, Box<dyn std::error::Error>> {
        format!("{}:{}", self.destination, self.port)
            .to_socket_addrs()?
            .next()
            .ok_or_else(|| "destination resolved to no address".into())
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();
    let config = Config::parse(std::env::args()).map_err(|message| {
        eprintln!("{message}");
        std::io::Error::new(std::io::ErrorKind::InvalidInput, message)
    })?;
    let destination = config.socket_addr()?;
    let socket = UdpSocket::bind("0.0.0.0:0")?;
    let interval = Duration::from_secs_f64(1.0 / config.rate_hz as f64);
    let mut next_tick = Instant::now();
    let mut sequence = 0;
    let mut previous = InputState::default();
    let started = Instant::now();
    tracing::info!(%destination, rate_hz = config.rate_hz, "sending input");
    loop {
        let state = if config.simulate {
            simulated_state(started.elapsed().as_secs_f32())
        } else {
            capture_state(&previous)?
        };
        let data = serde_json::to_vec(&Packet::new(state.clone(), sequence))?;
        socket.send_to(&data, destination)?;
        previous = state;
        sequence = sequence.wrapping_add(1);
        next_tick += interval;
        let now = Instant::now();
        if next_tick > now {
            thread::sleep(next_tick - now);
        } else {
            next_tick = now;
        }
    }
}

fn simulated_state(t: f32) -> InputState {
    InputState {
        mouse_x: (t * 0.5).sin(),
        mouse_y: (t * 0.5).cos(),
        w: (t as u32) % 2 == 0,
        ..InputState::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn capture_state(_: &InputState) -> Result<InputState, Box<dyn std::error::Error>> {
    Err("real input capture requires Windows".into())
}

#[cfg(target_os = "windows")]
fn capture_state(previous: &InputState) -> Result<InputState, Box<dyn std::error::Error>> {
    #[repr(C)]
    #[derive(Default)]
    struct Point { x: i32, y: i32 }
    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(point: *mut Point) -> i32;
        fn GetSystemMetrics(index: i32) -> i32;
        fn GetAsyncKeyState(key: i32) -> i16;
    }
    let mut point = Point::default();
    let (width, height, ok) = unsafe {
        (GetSystemMetrics(0), GetSystemMetrics(1), GetCursorPos(&mut point))
    };
    if ok == 0 || width <= 1 || height <= 1 {
        return Err("cannot read Windows cursor or display size".into());
    }
    let key = |code| unsafe { GetAsyncKeyState(code) < 0 };
    let pressed_keys = (0x41..=0x5A)
        .chain(0x30..=0x39)
        .chain(0x60..=0x69)
        .chain([
            0x08, 0x09, 0x0D, 0x14, 0x1B, 0x20, 0x2E,
            0x5B, 0x5C, 0x5D, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5,
            0x6E, 0x6F, 0xBC, 0xBE, 0xBF, 0xDC,
        ])
        .filter(|code| key(*code))
        .map(|code| code as u8)
        .collect();
    let x = (point.x as f32 / (width - 1) as f32 * 2.0 - 1.0).clamp(-1.0, 1.0);
    let y = (point.y as f32 / (height - 1) as f32 * 2.0 - 1.0).clamp(-1.0, 1.0);
    Ok(InputState {
        mouse_x: x,
        mouse_y: y,
        mouse_delta_x: x - previous.mouse_x,
        mouse_delta_y: y - previous.mouse_y,
        left_click: key(0x01),
        right_click: key(0x02),
        w: key(0x57), a: key(0x41), s: key(0x53), d: key(0x44),
        shift: key(0x10), ctrl: key(0x11), space: key(0x20),
        pressed_keys: Some(pressed_keys),
    })
}

#[cfg(test)]
mod tests {
    use super::Config;

    #[test]
    fn destination_is_required() {
        assert!(Config::parse(["gaming_input_relay"]).is_err());
    }

    #[test]
    fn destination_and_rate_are_configurable() {
        let config = Config::parse(["gaming_input_relay", "--destination", "100.104.83.28", "--rate", "30", "--simulate"]).unwrap();
        assert_eq!(config.destination, "100.104.83.28");
        assert_eq!(config.rate_hz, 30);
    }

    #[test]
    fn invalid_rate_is_rejected() {
        assert!(Config::parse(["gaming_input_relay", "--destination", "127.0.0.1", "--rate", "0"]).is_err());
    }
}

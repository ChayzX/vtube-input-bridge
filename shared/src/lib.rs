use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InputState {
    /// Normalized mouse X position (-1.0 to 1.0)
    pub mouse_x: f32,
    /// Normalized mouse Y position (-1.0 to 1.0)
    pub mouse_y: f32,
    /// Normalized mouse delta X since last packet
    pub mouse_delta_x: f32,
    /// Normalized mouse delta Y since last packet
    pub mouse_delta_y: f32,
    /// Left mouse button state
    pub left_click: bool,
    /// Right mouse button state
    pub right_click: bool,
    /// W key state
    pub w: bool,
    /// A key state
    pub a: bool,
    /// S key state
    pub s: bool,
    /// D key state
    pub d: bool,
    /// Left Shift key state
    pub shift: bool,
    /// Left Ctrl key state
    pub ctrl: bool,
    /// Space bar state
    pub space: bool,
    /// Windows virtual-key codes currently held down. None means an older sender.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pressed_keys: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Packet {
    /// Protocol version
    pub version: u8,
    /// Sequence number for detecting lost/reordered packets
    pub sequence: u64,
    /// Timestamp in milliseconds since Unix epoch
    pub timestamp: u64,
    /// Current input state
    pub state: InputState,
}

impl Packet {
    /// Create a new packet with the given state and sequence number
    pub fn new(state: InputState, sequence: u64) -> Self {
        use std::time::{SystemTime, UNIX_EPOCH};
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("Time went backwards")
            .as_millis() as u64;
        Packet {
            version: 1,
            sequence,
            timestamp,
            state,
        }
    }
}

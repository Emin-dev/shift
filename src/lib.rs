//! A small, dependency-free, bounded transition oracle.
//! This validates evidence order; it does not certify real deployments.

pub const MAX_DRAFT_BYTES: u32 = 4096;
pub const MAX_EVENTS: u32 = 64;
pub const MAX_ASSET_BYTES: usize = 1_048_576;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum Phase {
    Ready = 0,
    OldLoaded = 1,
    DraftSaved = 2,
    Deployed = 3,
    Passed = 4,
    Failed = 5,
    Recovered = 6,
    Cancelled = 7,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum Event {
    OpenOld = 1,
    SaveDraft = 2,
    Deploy = 3,
    ContinueOk = 4,
    ChunkMissing = 5,
    SessionExpired = 6,
    Recover = 7,
    Cancel = 8,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    UnknownPhase,
    UnknownEvent,
    InvalidTransition,
    ResourceLimit,
}

impl TryFrom<u32> for Phase {
    type Error = Error;
    fn try_from(value: u32) -> Result<Self, Error> {
        match value {
            0 => Ok(Self::Ready),
            1 => Ok(Self::OldLoaded),
            2 => Ok(Self::DraftSaved),
            3 => Ok(Self::Deployed),
            4 => Ok(Self::Passed),
            5 => Ok(Self::Failed),
            6 => Ok(Self::Recovered),
            7 => Ok(Self::Cancelled),
            _ => Err(Error::UnknownPhase),
        }
    }
}
impl TryFrom<u32> for Event {
    type Error = Error;
    fn try_from(value: u32) -> Result<Self, Error> {
        match value {
            1 => Ok(Self::OpenOld),
            2 => Ok(Self::SaveDraft),
            3 => Ok(Self::Deploy),
            4 => Ok(Self::ContinueOk),
            5 => Ok(Self::ChunkMissing),
            6 => Ok(Self::SessionExpired),
            7 => Ok(Self::Recover),
            8 => Ok(Self::Cancel),
            _ => Err(Error::UnknownEvent),
        }
    }
}

pub fn transition(phase: Phase, event: Event) -> Result<Phase, Error> {
    use Event::*;
    use Phase::*;
    if event == Cancel && matches!(phase, Ready | OldLoaded | DraftSaved | Deployed | Failed) {
        return Ok(Cancelled);
    }
    match (phase, event) {
        (Ready, OpenOld) => Ok(OldLoaded),
        (OldLoaded, SaveDraft) => Ok(DraftSaved),
        (DraftSaved, Deploy) => Ok(Deployed),
        (Deployed, ContinueOk) => Ok(Passed),
        (Deployed, ChunkMissing | SessionExpired) => Ok(Failed),
        (Failed, Recover) => Ok(Recovered),
        _ => Err(Error::InvalidTransition),
    }
}

pub fn validate_draft(bytes: u32) -> bool {
    bytes > 0 && bytes <= MAX_DRAFT_BYTES
}

/// 0 pending, 1 pass, 2 recoverable failure, 3 recovered, 4 cancelled, 5 unsafe recovery.
pub fn outcome(phase: Phase, draft_preserved: bool) -> u32 {
    match phase {
        Phase::Passed if draft_preserved => 1,
        Phase::Passed => 5,
        Phase::Failed => 2,
        Phase::Recovered if draft_preserved => 3,
        Phase::Recovered => 5,
        Phase::Cancelled => 4,
        _ => 0,
    }
}

/// Safe exact route matcher: no user-supplied hosts or filesystem paths are accepted.
pub fn fixture_asset_path(path: &str) -> Option<&'static str> {
    match path {
        "/fixture" | "/fixture/" => Some("fixtures/runtime.html"),
        "/fixture/v1/shell.js" => Some("fixtures/v1/shell.js"),
        "/fixture/v1/checkout.js" => Some("fixtures/v1/checkout.js"),
        "/fixture/v2/shell.js" => Some("fixtures/v2/shell.js"),
        "/fixture/v2/checkout.js" => Some("fixtures/v2/checkout.js"),
        _ => None,
    }
}

#[no_mangle]
pub extern "C" fn shift_version() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn shift_validate_draft(bytes: u32) -> u32 {
    validate_draft(bytes) as u32
}
#[no_mangle]
pub extern "C" fn shift_max_events() -> u32 {
    MAX_EVENTS
}
#[no_mangle]
pub extern "C" fn shift_transition(phase: u32, event: u32) -> u32 {
    let result =
        Phase::try_from(phase).and_then(|p| Event::try_from(event).and_then(|e| transition(p, e)));
    result.map(|p| p as u32).unwrap_or(u32::MAX)
}
#[no_mangle]
pub extern "C" fn shift_outcome(phase: u32, draft_preserved: u32) -> u32 {
    Phase::try_from(phase)
        .map(|p| outcome(p, draft_preserved == 1))
        .unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn successful_old_tab_journey() {
        let mut p = Phase::Ready;
        for e in [
            Event::OpenOld,
            Event::SaveDraft,
            Event::Deploy,
            Event::ContinueOk,
        ] {
            p = transition(p, e).unwrap();
        }
        assert_eq!(outcome(p, true), 1);
    }
    #[test]
    fn retired_asset_recovery() {
        let mut p = Phase::Ready;
        for e in [
            Event::OpenOld,
            Event::SaveDraft,
            Event::Deploy,
            Event::ChunkMissing,
            Event::Recover,
        ] {
            p = transition(p, e).unwrap();
        }
        assert_eq!(outcome(p, true), 3);
    }
    #[test]
    fn session_expiry_is_failure() {
        assert_eq!(
            transition(Phase::Deployed, Event::SessionExpired),
            Ok(Phase::Failed)
        );
    }
    #[test]
    fn lost_draft_is_never_safe() {
        assert_eq!(outcome(Phase::Recovered, false), 5);
        assert_eq!(outcome(Phase::Passed, false), 5);
    }
    #[test]
    fn recovery_requires_failure() {
        for p in [
            Phase::Ready,
            Phase::OldLoaded,
            Phase::DraftSaved,
            Phase::Deployed,
            Phase::Passed,
            Phase::Recovered,
            Phase::Cancelled,
        ] {
            assert!(transition(p, Event::Recover).is_err());
        }
    }
    #[test]
    fn cannot_deploy_before_saving() {
        assert!(transition(Phase::OldLoaded, Event::Deploy).is_err());
    }
    #[test]
    fn cancelled_run_is_terminal() {
        let p = transition(Phase::DraftSaved, Event::Cancel).unwrap();
        for e in [
            Event::OpenOld,
            Event::SaveDraft,
            Event::Deploy,
            Event::ContinueOk,
            Event::Cancel,
        ] {
            assert!(transition(p, e).is_err());
        }
    }
    #[test]
    fn passed_run_is_terminal() {
        assert!(transition(Phase::Passed, Event::ContinueOk).is_err());
        assert!(transition(Phase::Passed, Event::Cancel).is_err());
    }
    #[test]
    fn byte_limits_include_multibyte() {
        assert!(!validate_draft(0));
        assert!(validate_draft(4096));
        assert!(!validate_draft(4097));
        let text = "🦀".repeat(1025);
        assert!(!validate_draft(text.len() as u32));
    }
    #[test]
    fn unknown_abi_values_are_rejected() {
        assert_eq!(shift_transition(55, 1), u32::MAX);
        assert_eq!(shift_transition(0, 99), u32::MAX);
        assert_eq!(shift_outcome(99, 1), u32::MAX);
    }
    #[test]
    fn arbitrary_routes_rejected() {
        for p in [
            "/fixture/../../secret",
            "https://example.com/",
            "/fixture/v1/checkout.js/",
            "/fixture/v1/%2e%2e/secrets",
            "/api/proxy?url=http://127.0.0.1",
        ] {
            assert!(fixture_asset_path(p).is_none());
        }
    }
    #[test]
    fn route_allowlist_is_exact() {
        assert_eq!(
            fixture_asset_path("/fixture/v1/checkout.js"),
            Some("fixtures/v1/checkout.js")
        );
    }
}

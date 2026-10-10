//! Local fixture controller, not a general proxy or public service.
use shift_core::MAX_ASSET_BYTES;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
const PORT: u16 = 4183;
const MAX_CONNECTIONS: usize = 8;
const MAX_HEADER_BYTES: usize = 8192;
const REQUEST_BUDGET: Duration = Duration::from_secs(2);
#[derive(Clone)]
struct Run {
    deployed: bool,
    scenario: String,
    session_renewed: bool,
}
#[derive(Debug, PartialEq, Eq)]
struct Request {
    method: String,
    target: String,
    headers: HashMap<String, String>,
}
struct Reply {
    status: String,
    kind: String,
    body: Vec<u8>,
    cache: String,
}
struct ConnectionGuard(Arc<AtomicUsize>);
impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
fn main() -> std::io::Result<()> {
    let root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("web"));
    if !root.join("index.html").is_file() {
        eprintln!("Pass the web directory as the first argument.");
        std::process::exit(2);
    }
    let root = Arc::new(root);
    let runs = Arc::new(Mutex::new(HashMap::<String, Run>::new()));
    let active = Arc::new(AtomicUsize::new(0));
    let listener = TcpListener::bind(("127.0.0.1", PORT))?;
    println!("Shift local fixture: http://127.0.0.1:{PORT} (loopback only; eight connections; two-second total budget)");
    for stream in listener.incoming().flatten() {
        let deadline = Instant::now() + REQUEST_BUDGET;
        if !reserve_connection(&active) {
            let _ = stream.shutdown(Shutdown::Both);
            continue;
        }
        let guard = ConnectionGuard(Arc::clone(&active));
        let root = Arc::clone(&root);
        let runs = Arc::clone(&runs);
        // Parsing and all socket I/O happen without the shared state lock.
        // The bounded guard is moved into the closure and released on success, error or panic.
        let _ = thread::Builder::new()
            .name("shift-fixture".into())
            .spawn(move || {
                let _guard = guard;
                let mut stream = stream;
                let result = match read_request(&mut stream, deadline) {
                    Ok(request) => match runs.lock() {
                        Ok(mut state) => dispatch(&request, &root, &mut state),
                        Err(_) => reply(
                            "503 Service Unavailable",
                            "text/plain",
                            b"Fixture state unavailable",
                            "no-store",
                        ),
                    },
                    Err(status) => reply(
                        status,
                        "text/plain",
                        b"Invalid, oversized or expired HTTP request",
                        "no-store",
                    ),
                };
                let result = result.unwrap_or_else(|_| Reply {
                    status: "500 Internal Server Error".into(),
                    kind: "text/plain".into(),
                    body: b"Fixture resource unavailable".to_vec(),
                    cache: "no-store".into(),
                });
                let _ = write_reply(&mut stream, result, deadline);
                let _ = stream.shutdown(Shutdown::Both);
            });
    }
    Ok(())
}
fn reserve_connection(active: &AtomicUsize) -> bool {
    let mut count = active.load(Ordering::Acquire);
    loop {
        if count >= MAX_CONNECTIONS {
            return false;
        }
        match active.compare_exchange_weak(count, count + 1, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => return true,
            Err(actual) => count = actual,
        }
    }
}
fn remaining(deadline: Instant) -> std::io::Result<Duration> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|d| !d.is_zero())
        .ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::TimedOut, "Total request budget elapsed")
        })
}
fn read_request(stream: &mut TcpStream, deadline: Instant) -> Result<Request, &'static str> {
    let mut bytes = Vec::with_capacity(1024);
    let mut buffer = [0u8; 1024];
    loop {
        let budget = remaining(deadline).map_err(|_| "408 Request Timeout")?;
        stream
            .set_read_timeout(Some(budget))
            .map_err(|_| "400 Bad Request")?;
        let n = stream.read(&mut buffer).map_err(|e| {
            if matches!(
                e.kind(),
                std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
            ) {
                "408 Request Timeout"
            } else {
                "400 Bad Request"
            }
        })?;
        if n == 0 {
            return Err("400 Bad Request");
        }
        bytes.extend_from_slice(&buffer[..n]);
        if let Some(end) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
            if end + 4 > MAX_HEADER_BYTES {
                return Err("431 Request Header Fields Too Large");
            }
            // Never decode or interpret anything after the first header terminator.
            return parse_request(&bytes[..end]);
        }
        if bytes.len() >= MAX_HEADER_BYTES {
            return Err("431 Request Header Fields Too Large");
        }
    }
}
fn parse_request(bytes: &[u8]) -> Result<Request, &'static str> {
    let request = std::str::from_utf8(bytes).map_err(|_| "400 Bad Request")?;
    let mut lines = request.split("\r\n");
    let parts: Vec<_> = lines.next().unwrap_or("").split(' ').collect();
    if parts.len() != 3
        || !["GET", "POST"].contains(&parts[0])
        || parts[2] != "HTTP/1.1"
        || !parts[1].starts_with('/')
        || !parts[1].bytes().all(|b| (0x21..=0x7e).contains(&b))
    {
        return Err("400 Bad Request");
    }
    let mut headers = HashMap::new();
    for line in lines {
        if headers.len() >= 64 {
            return Err("431 Request Header Fields Too Large");
        }
        let (name, value) = line.split_once(':').ok_or("400 Bad Request")?;
        if name.is_empty()
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
            || value
                .bytes()
                .any(|b| !(b == b'\t' || (0x20..=0x7e).contains(&b)))
        {
            return Err("400 Bad Request");
        }
        let name = name.to_ascii_lowercase();
        // Reject all duplicates, including case variants of Host, Origin and length headers.
        if headers.insert(name, value.trim().to_string()).is_some() {
            return Err("400 Bad Request");
        }
    }
    // This fixture protocol never accepts a request body or transfer framing.
    if headers.contains_key("transfer-encoding") {
        return Err("400 Bad Request");
    }
    if let Some(length) = headers.get("content-length") {
        if length.is_empty() || !length.bytes().all(|b| b.is_ascii_digit()) {
            return Err("400 Bad Request");
        }
        if length.parse::<u64>() != Ok(0) {
            return Err("413 Content Too Large");
        }
    }
    Ok(Request {
        method: parts[0].to_string(),
        target: parts[1].to_string(),
        headers,
    })
}
fn reply(status: &str, kind: &str, body: &[u8], cache: &str) -> std::io::Result<Reply> {
    Ok(Reply {
        status: status.into(),
        kind: kind.into(),
        body: body.to_vec(),
        cache: cache.into(),
    })
}
fn write_reply(stream: &mut TcpStream, result: Reply, deadline: Instant) -> std::io::Result<()> {
    let mut bytes=format!("HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: {}\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'\r\nConnection: close\r\n\r\n",result.status,result.kind,result.body.len(),result.cache).into_bytes();
    bytes.extend_from_slice(&result.body);
    let mut offset = 0;
    while offset < bytes.len() {
        stream.set_write_timeout(Some(remaining(deadline)?))?;
        let n = stream.write(&bytes[offset..])?;
        if n == 0 {
            return Err(std::io::ErrorKind::WriteZero.into());
        }
        offset += n;
    }
    Ok(())
}
fn dispatch(
    request: &Request,
    root: &std::path::Path,
    runs: &mut HashMap<String, Run>,
) -> std::io::Result<Reply> {
    let method = request.method.as_str();
    let (path, query) = request
        .target
        .split_once('?')
        .unwrap_or((&request.target, ""));
    let headers = &request.headers;
    if headers.get("host").map(String::as_str) != Some("127.0.0.1:4183") {
        return reply(
            "403 Forbidden",
            "text/plain",
            b"Loopback host required",
            "no-store",
        );
    }
    let params: HashMap<_, _> = query.split('&').filter_map(|p| p.split_once('=')).collect();
    let run = params.get("run").copied().unwrap_or("");
    let valid_run = (8..=32).contains(&run.len()) && run.bytes().all(|b| b.is_ascii_alphanumeric());
    if path.starts_with("/__shift/") {
        if path == "/__shift/capabilities" && method == "GET" {
            return reply(
                "200 OK",
                "application/json",
                br#"{"mode":"local-controller","externalTargets":false,"version":1}"#,
                "no-store",
            );
        }
        if method != "POST"
            || headers.get("origin").map(String::as_str) != Some("http://127.0.0.1:4183")
            || !valid_run
        {
            return reply(
                "403 Forbidden",
                "text/plain",
                b"Same-origin POST and bounded run ID required",
                "no-store",
            );
        }
        match path {
            "/__shift/reset" => {
                let scenario = params.get("scenario").copied().unwrap_or("");
                if !["retired", "retained", "expired"].contains(&scenario) {
                    return reply(
                        "400 Bad Request",
                        "text/plain",
                        b"Unknown scenario",
                        "no-store",
                    );
                }
                if runs.len() >= 8 && !runs.contains_key(run) {
                    return reply(
                        "429 Too Many Requests",
                        "text/plain",
                        b"Eight concurrent fixture runs maximum. Reset an old run.",
                        "no-store",
                    );
                }
                runs.insert(
                    run.to_string(),
                    Run {
                        deployed: false,
                        scenario: scenario.to_string(),
                        session_renewed: false,
                    },
                );
            }
            "/__shift/deploy" => match runs.get_mut(run) {
                Some(r) => r.deployed = true,
                None => return reply("404 Not Found", "text/plain", b"Unknown run", "no-store"),
            },
            "/__shift/renew" => match runs.get_mut(run) {
                Some(r) if r.deployed => r.session_renewed = true,
                _ => {
                    return reply(
                        "409 Conflict",
                        "text/plain",
                        b"Deploy before renewing the synthetic session",
                        "no-store",
                    )
                }
            },
            "/__shift/end" => {
                runs.remove(run);
            }
            _ => {
                return reply(
                    "404 Not Found",
                    "text/plain",
                    b"Unknown operation",
                    "no-store",
                )
            }
        }
        return reply("200 OK", "application/json", b"{\"ok\":true}", "no-store");
    }
    if method != "GET" {
        return reply(
            "405 Method Not Allowed",
            "text/plain",
            b"GET only",
            "no-store",
        );
    }
    if path == "/fixture/session" {
        let active = match runs.get(run) {
            Some(r) => r,
            None => {
                return reply(
                    "404 Not Found",
                    "application/json",
                    b"{\"valid\":false}",
                    "no-store",
                )
            }
        };
        return if active.deployed && active.scenario == "expired" && !active.session_renewed {
            reply(
                "401 Unauthorized",
                "application/json",
                b"{\"valid\":false}",
                "no-store",
            )
        } else {
            reply(
                "200 OK",
                "application/json",
                b"{\"valid\":true}",
                "no-store",
            )
        };
    }
    if path.starts_with("/fixture/") || path == "/fixture" {
        let active = match runs.get(run) {
            Some(r) => r,
            None => {
                return reply(
                    "404 Not Found",
                    "text/plain",
                    b"Unknown fixture run",
                    "no-store",
                )
            }
        };
        if path == "/fixture/v1/checkout.js" && active.deployed && active.scenario == "retired" {
            return reply(
                "410 Gone",
                "text/plain",
                b"Pinned v1 asset deliberately retired by this local fixture",
                "no-store",
            );
        }
        let resource = match shift_core::fixture_asset_path(path) {
            Some(p) => p,
            None => {
                return reply(
                    "404 Not Found",
                    "text/plain",
                    b"Not a fixture route",
                    "no-store",
                )
            }
        };
        let mut body = fs::read(root.join(resource))?;
        if path == "/fixture" || path == "/fixture/" {
            let version = if active.deployed { "v2" } else { "v1" };
            body = String::from_utf8_lossy(&body)
                .replace("__VERSION__", version)
                .replace("__RUN__", run)
                .into_bytes();
        }
        let kind = if resource.ends_with(".js") {
            "text/javascript; charset=utf-8"
        } else {
            "text/html; charset=utf-8"
        };
        return reply(
            "200 OK",
            kind,
            &body,
            if resource.ends_with(".js") {
                "public, max-age=31536000, immutable"
            } else {
                "no-store"
            },
        );
    }
    let file = match path {
        "/" | "/index.html" => "index.html",
        "/app.js" => "app.js",
        "/style.css" => "style.css",
        "/assets/shift_core.wasm" => "assets/shift_core.wasm",
        "/fixtures/frame.js" => "fixtures/frame.js",
        "/fixtures/frame.css" => "fixtures/frame.css",
        "/fixtures/v1/index.html" => "fixtures/v1/index.html",
        "/fixtures/v2/index.html" => "fixtures/v2/index.html",
        "/fixtures/v1/checkout.js" => "fixtures/v1/checkout.js",
        "/fixtures/v2/checkout.js" => "fixtures/v2/checkout.js",
        "/fixtures/session.json" => "fixtures/session.json",
        "/favicon.svg" => "favicon.svg",
        _ => {
            return reply(
                "404 Not Found",
                "text/plain",
                b"Resource not found",
                "no-store",
            )
        }
    };
    let body = fs::read(root.join(file))?;
    if body.len() > MAX_ASSET_BYTES {
        return reply(
            "413 Content Too Large",
            "text/plain",
            b"Asset exceeds bounded server limit",
            "no-store",
        );
    }
    let kind = if file.ends_with(".wasm") {
        "application/wasm"
    } else if file.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if file.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if file.ends_with(".json") {
        "application/json"
    } else if file.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "text/html; charset=utf-8"
    };
    reply("200 OK", kind, &body, "no-cache")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(extra: &str) -> Result<Request, &'static str> {
        parse_request(format!("POST /__shift/reset?run=test12345&scenario=retained HTTP/1.1\r\nHost: 127.0.0.1:4183\r\nOrigin: http://127.0.0.1:4183{extra}").as_bytes())
    }
    #[test]
    fn allows_only_bodyless_fixture_requests() {
        assert!(parse("\r\nContent-Length: 0").is_ok());
        assert_eq!(
            parse("\r\nContent-Length: 31").unwrap_err(),
            "413 Content Too Large"
        );
    }
    #[test]
    fn rejects_duplicate_critical_headers() {
        for extra in [
            "\r\nHost: untrusted.example",
            "\r\nhOsT: 127.0.0.1:4183",
            "\r\nOrigin: https://untrusted.example",
            "\r\nContent-Length: 0\r\ncontent-length: 0",
        ] {
            assert_eq!(parse(extra).unwrap_err(), "400 Bad Request");
        }
    }
    #[test]
    fn rejects_malformed_and_folded_headers() {
        for extra in [
            "\r\n Host: 127.0.0.1:4183",
            "\r\nOrigin : http://127.0.0.1:4183",
            "\r\nMissingColon",
            "\r\nX-Bad: value\nOrigin: other",
            "\r\n: empty",
        ] {
            assert_eq!(parse(extra).unwrap_err(), "400 Bad Request");
        }
    }
    #[test]
    fn rejects_transfer_framing_and_invalid_lengths() {
        for extra in [
            "\r\nTransfer-Encoding: chunked",
            "\r\nContent-Length: -1",
            "\r\nContent-Length: 0,0",
            "\r\nContent-Length: ",
            "\r\nContent-Length: +0",
        ] {
            assert!(parse(extra).is_err());
        }
    }
    #[test]
    fn rejects_unbounded_header_count() {
        let fields = (0..64)
            .map(|i| format!("\r\nX-Test-{i}: value"))
            .collect::<String>();
        assert_eq!(
            parse(&fields).unwrap_err(),
            "431 Request Header Fields Too Large"
        );
    }
    #[test]
    fn connection_slots_are_bounded_and_released() {
        let count = Arc::new(AtomicUsize::new(0));
        for _ in 0..8 {
            assert!(reserve_connection(&count));
        }
        assert!(!reserve_connection(&count));
        drop(ConnectionGuard(Arc::clone(&count)));
        assert!(reserve_connection(&count));
        assert_eq!(count.load(Ordering::Acquire), 8);
    }
    #[test]
    fn deadline_is_total_not_per_read() {
        let deadline = Instant::now() - Duration::from_millis(1);
        assert_eq!(
            remaining(deadline).unwrap_err().kind(),
            std::io::ErrorKind::TimedOut
        );
    }
}

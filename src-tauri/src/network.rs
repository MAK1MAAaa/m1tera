use std::{collections::HashMap, net::IpAddr};
use url::Host;

const PROXY_ENV_KEYS: &[&str] = &[
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
];
// Node fetch matches IPv6 URL authorities with brackets; retain both spellings.
const LOCAL_NO_PROXY: &str = "localhost,127.0.0.1,::1,[::1]";

/// Only add defaults. Explicit environment values, including empty values and
/// authenticated proxy URLs, stay untouched and are never copied into logs.
pub fn sidecar_environment() -> Vec<(&'static str, String)> {
    let explicit_proxy = PROXY_ENV_KEYS
        .iter()
        .any(|key| std::env::var_os(key).is_some());
    let explicit_no_proxy =
        std::env::var_os("NO_PROXY").is_some() || std::env::var_os("no_proxy").is_some();

    #[cfg(target_os = "macos")]
    let system = if explicit_proxy {
        None
    } else {
        std::process::Command::new("/usr/sbin/scutil")
            .arg("--proxy")
            .output()
            .ok()
            .filter(|output| output.status.success() && output.stdout.len() <= 64 * 1024)
            .and_then(|output| String::from_utf8(output.stdout).ok())
    };
    #[cfg(not(target_os = "macos"))]
    let system: Option<String> = None;

    environment_defaults(explicit_proxy, explicit_no_proxy, system.as_deref())
}

fn environment_defaults(
    explicit_proxy: bool,
    explicit_no_proxy: bool,
    system: Option<&str>,
) -> Vec<(&'static str, String)> {
    let mut additions = Vec::new();
    if !explicit_proxy {
        if let Some(system) = system {
            additions.extend(parse_system_proxies(system));
        }
    }
    if !explicit_no_proxy {
        additions.push(("NO_PROXY", LOCAL_NO_PROXY.into()));
    }
    additions
}

fn parse_system_proxies(text: &str) -> Vec<(&'static str, String)> {
    let mut fields = HashMap::new();
    let mut depth: usize = 0;
    for line in text.lines() {
        if depth == 1 {
            if let Some((key, value)) = line.trim().split_once(':') {
                fields.insert(key.trim(), value.trim());
            }
        }
        depth = depth
            .saturating_add(line.matches('{').count())
            .saturating_sub(line.matches('}').count());
    }
    let mut proxies = Vec::new();
    for (prefix, name) in [("HTTP", "HTTP_PROXY"), ("HTTPS", "HTTPS_PROXY")] {
        if fields.get(format!("{prefix}Enable").as_str()).copied() != Some("1") {
            continue;
        }
        let host = fields.get(format!("{prefix}Proxy").as_str()).copied();
        let port = fields.get(format!("{prefix}Port").as_str()).copied();
        if let (Some(host), Some(port)) = (host, port) {
            if let Some(proxy) = validated_proxy_url(host, port) {
                proxies.push((name, proxy));
            }
        }
    }
    proxies
}

fn validated_proxy_url(host: &str, port: &str) -> Option<String> {
    let port = port.parse::<u16>().ok().filter(|port| *port > 0)?;
    if host.is_empty()
        || host.len() > 253
        || host.chars().any(|character| {
            character.is_whitespace()
                || character.is_control()
                || matches!(character, '@' | '/' | '\\' | '?' | '#' | '%')
        })
    {
        return None;
    }
    let literal = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host);
    let authority = match literal.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.to_string(),
        Ok(IpAddr::V6(ip)) => format!("[{ip}]"),
        Err(_) => Host::parse(host).ok()?.to_string(),
    };
    // macOS's "secure web proxy" routes HTTPS using HTTP CONNECT; it does not
    // mean the connection to the proxy itself uses TLS.
    Some(format!("http://{authority}:{port}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dictionary(fields: &str) -> String {
        format!("<dictionary> {{\n{fields}\n}}")
    }

    #[test]
    fn enabled_system_http_and_https_proxies_are_injected() {
        let settings = dictionary("HTTPEnable : 1\nHTTPProxy : proxy.example\nHTTPPort : 8080\nHTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 8443");
        assert_eq!(
            environment_defaults(false, false, Some(&settings)),
            vec![
                ("HTTP_PROXY", "http://proxy.example:8080".into()),
                ("HTTPS_PROXY", "http://127.0.0.1:8443".into()),
                ("NO_PROXY", LOCAL_NO_PROXY.into()),
            ]
        );
    }

    #[test]
    fn explicit_environment_and_no_proxy_are_preserved() {
        let settings = dictionary("HTTPEnable : 1\nHTTPProxy : proxy.example\nHTTPPort : 8080");
        assert!(environment_defaults(true, true, Some(&settings)).is_empty());
        assert_eq!(
            environment_defaults(true, false, Some(&settings)),
            vec![("NO_PROXY", LOCAL_NO_PROXY.into())]
        );
        assert_eq!(environment_defaults(false, true, None), vec![]);
    }

    #[test]
    fn disabled_missing_or_nested_system_proxy_is_not_used() {
        let settings = dictionary("HTTPEnable : 0\nHTTPProxy : proxy.example\nHTTPPort : 8080\nHTTPSProxy : missing-enable.example\nHTTPSPort : 8443\nScoped : <dictionary> {\nHTTPEnable : 1\nHTTPProxy : scoped.example\nHTTPPort : 9999\n}");
        assert!(parse_system_proxies(&settings).is_empty());
    }

    #[test]
    fn ipv6_authorities_are_bracketed() {
        assert_eq!(
            validated_proxy_url("::1", "8080"),
            Some("http://[::1]:8080".into())
        );
        assert_eq!(
            validated_proxy_url("[2001:db8::1]", "8080"),
            Some("http://[2001:db8::1]:8080".into())
        );
        assert!(validated_proxy_url("[::1", "8080").is_none());
    }

    #[test]
    fn invalid_ports_and_userinfo_are_rejected_without_errors_echoing_input() {
        for port in ["0", "65536", "-1", "8080/path", "8080;other", ""] {
            assert!(validated_proxy_url("proxy.example", port).is_none());
        }
        for host in [
            "user:password@proxy.example",
            "https://proxy.example",
            "proxy.example/path",
            "proxy.example#fragment",
            "proxy.example?query",
            "proxy.example\n",
            "proxy%40example",
            "",
        ] {
            assert!(validated_proxy_url(host, "8080").is_none());
        }
    }
}

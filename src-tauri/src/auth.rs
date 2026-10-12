use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use url::Url;

fn validate_auth_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "ChatGPT 登录地址无效")?;
    if url.scheme() != "https"
        || url.host_str() != Some("auth.openai.com")
        || url.path() != "/api/accounts/authorize"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
        || url.fragment().is_some()
    {
        return Err("只允许打开官方 ChatGPT 授权地址".into());
    }
    Ok(url)
}

#[tauri::command]
pub fn open_auth_url(app: AppHandle, url: String) -> Result<(), String> {
    let url = validate_auth_url(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "无法在系统浏览器中打开 ChatGPT 登录页面".into())
}

fn validate_external_url(value: &str) -> Result<Url, String> {
    if value.len() > 4096 {
        return Err("链接过长".into());
    }
    let url = Url::parse(value).map_err(|_| "链接无效")?;
    if !["https", "http"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("只允许打开无凭据的网页链接".into());
    }
    Ok(url)
}

#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "无法在系统浏览器中打开链接".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_official_authorization_endpoint() {
        assert!(
            validate_auth_url("https://auth.openai.com/api/accounts/authorize?state=abc").is_ok()
        );
        for url in [
            "http://auth.openai.com/api/accounts/authorize",
            "https://auth.openai.com.evil.example/api/accounts/authorize",
            "https://user@auth.openai.com/api/accounts/authorize",
            "https://auth.openai.com:8443/api/accounts/authorize",
            "https://auth.openai.com/api/accounts/authorize#unsafe",
            "https://auth.openai.com/oauth/authorize",
            "file:///tmp/authorize",
        ] {
            assert!(validate_auth_url(url).is_err());
        }
    }

    #[test]
    fn external_links_cannot_open_files_commands_or_embedded_credentials() {
        assert!(validate_external_url("https://example.com/source?q=test").is_ok());
        for value in [
            "file:///tmp/private",
            "javascript:alert(1)",
            "https://user:secret@example.com",
            "ssh://example.com",
        ] {
            assert!(validate_external_url(value).is_err());
        }
    }
}

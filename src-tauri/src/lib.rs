use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::Url;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub favicon: Option<String>,
    pub site_name: Option<String>,
}

static RE_TITLE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<title[^>]*>(.*?)</title>").unwrap());
static RE_META: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?is)<meta\s+([^>]+?)/?>"#).unwrap()
});
static RE_ATTR: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?i)([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))"#).unwrap());
static RE_LINK_ICON: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?is)<link\s+([^>]+?)/?>"#).unwrap()
});

fn decode_basic_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
}

fn clean_text(s: &str) -> String {
    let t = decode_basic_entities(s);
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn attr_map(attrs: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for cap in RE_ATTR.captures_iter(attrs) {
        let key = cap.get(1).map(|m| m.as_str().to_ascii_lowercase()).unwrap_or_default();
        let val = cap
            .get(3)
            .or_else(|| cap.get(4))
            .or_else(|| cap.get(5))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();
        map.insert(key, val);
    }
    map
}

fn abs_url(base: &Url, href: &str) -> Option<String> {
    let href = href.trim();
    if href.is_empty() || href.starts_with("data:") {
        return None;
    }
    base.join(href).ok().map(|u| u.to_string())
}

fn parse_preview(html: &str, page_url: &Url) -> LinkPreview {
    let mut og: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut name_meta: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for cap in RE_META.captures_iter(html) {
        let attrs = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let map = attr_map(attrs);
        let content = map
            .get("content")
            .cloned()
            .unwrap_or_default();
        if content.is_empty() {
            continue;
        }
        if let Some(prop) = map
            .get("property")
            .or_else(|| map.get("name"))
            .or_else(|| map.get("itemprop"))
        {
            let key = prop.to_ascii_lowercase();
            if key.starts_with("og:") || key.starts_with("twitter:") {
                og.entry(key).or_insert(content);
            } else {
                name_meta.entry(key).or_insert(content);
            }
        }
    }

    let title = og
        .get("og:title")
        .or_else(|| og.get("twitter:title"))
        .cloned()
        .or_else(|| {
            RE_TITLE
                .captures(html)
                .and_then(|c| c.get(1).map(|m| clean_text(m.as_str())))
                .filter(|s| !s.is_empty())
        })
        .map(|s| clean_text(&s));

    let description = og
        .get("og:description")
        .or_else(|| og.get("twitter:description"))
        .or_else(|| name_meta.get("description"))
        .cloned()
        .map(|s| clean_text(&s));

    let image = og
        .get("og:image:secure_url")
        .or_else(|| og.get("og:image:url"))
        .or_else(|| og.get("og:image"))
        .or_else(|| og.get("twitter:image"))
        .or_else(|| og.get("twitter:image:src"))
        .or_else(|| name_meta.get("thumbnail"))
        .or_else(|| name_meta.get("thumbnailurl"))
        .or_else(|| name_meta.get("image"))
        .and_then(|href| {
            // Protocol-relative URLs //cdn.example.com/...
            let href = href.trim();
            if href.starts_with("//") {
                return Some(format!("{}:{}", page_url.scheme(), href));
            }
            abs_url(page_url, href)
        });

    let site_name = og
        .get("og:site_name")
        .cloned()
        .map(|s| clean_text(&s));

    let mut favicon: Option<String> = None;
    let mut best_icon_score = -1i32;
    let mut linked_preview_image: Option<String> = None;
    for cap in RE_LINK_ICON.captures_iter(html) {
        let attrs = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let map = attr_map(attrs);
        let rel = map
            .get("rel")
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        if rel.split_whitespace().any(|part| part == "image_src") {
            if linked_preview_image.is_none() {
                linked_preview_image = map.get("href").and_then(|href| abs_url(page_url, href));
            }
            continue;
        }
        if !(rel.contains("icon") || rel.contains("apple-touch-icon")) {
            continue;
        }
        let href = match map.get("href") {
            Some(h) => h,
            None => continue,
        };
        let score = if rel.contains("apple-touch-icon") {
            30
        } else if rel.contains("shortcut") {
            20
        } else {
            10
        };
        if score > best_icon_score {
            if let Some(abs) = abs_url(page_url, href) {
                best_icon_score = score;
                favicon = Some(abs);
            }
        }
    }

    LinkPreview {
        title,
        description,
        image: image.or(linked_preview_image),
        favicon,
        site_name,
    }
}

/// Cap preview image size (bytes) so invoke payload stays reasonable. Modern OG
/// images are commonly larger than 1.5 MB, especially when a site serves AVIF
/// or an unoptimised social image.
const MAX_PREVIEW_IMAGE_BYTES: usize = 6_000_000;

/// Download an image with page Referer (anti-hotlink) and return a data URL.
/// WebView often fails on raw og:image URLs (Referer / CDN blocks); data URLs always work.
async fn fetch_as_data_url(
    client: &reqwest::Client,
    image_url: &str,
    referer: &str,
) -> Option<String> {
    let parsed = Url::parse(image_url).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }

    let mut request = client
        .get(parsed)
        .header("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9");
    if !referer.is_empty() {
        request = request.header("Referer", referer);
    }

    let resp = request.send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let mut mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .split(';')
        .next()
        .unwrap_or("image/jpeg")
        .trim()
        .to_string();

    // Some CDNs return octet-stream; sniff from URL extension
    if !mime.starts_with("image/") {
        let path = image_url.to_ascii_lowercase();
        mime = if path.contains(".png") {
            "image/png".into()
        } else if path.contains(".webp") {
            "image/webp".into()
        } else if path.contains(".gif") {
            "image/gif".into()
        } else if path.contains(".svg") {
            "image/svg+xml".into()
        } else {
            "image/jpeg".into()
        };
    }

    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > MAX_PREVIEW_IMAGE_BYTES {
        return None;
    }

    // Basic magic-byte sniffs if MIME is still generic
    if mime == "application/octet-stream" || mime == "binary/octet-stream" {
        if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
            mime = "image/png".into();
        } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            mime = "image/jpeg".into();
        } else if bytes.starts_with(b"GIF8") {
            mime = "image/gif".into();
        } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            mime = "image/webp".into();
        }
    }

    if !mime.starts_with("image/") {
        return None;
    }

    Some(format!("data:{};base64,{}", mime, B64.encode(&bytes)))
}

/// Microlink is also used by the browser build. Calling it from Rust avoids the
/// different CORS/origin rules of a packaged WebView and provides metadata for
/// pages which reject non-browser HTML clients.
async fn fetch_microlink_preview(
    client: &reqwest::Client,
    page_url: &Url,
) -> Option<LinkPreview> {
    let mut endpoint = Url::parse("https://api.microlink.io").ok()?;
    endpoint.query_pairs_mut()
        .append_pair("url", page_url.as_str())
        .append_pair("palette", "false")
        .append_pair("audio", "false")
        .append_pair("video", "false")
        .append_pair("iframe", "false");

    let response = client.get(endpoint).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let json: serde_json::Value = response.json().await.ok()?;
    if json.get("status")?.as_str()? != "success" {
        return None;
    }
    let data = json.get("data")?;
    let text = |key: &str| {
        data.get(key)
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
    };
    let nested_url = |key: &str| {
        data.get(key)
            .and_then(|value| value.get("url"))
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
    };

    Some(LinkPreview {
        title: text("title"),
        description: text("description"),
        image: nested_url("image").or_else(|| nested_url("screenshot")),
        favicon: nested_url("logo"),
        site_name: text("publisher"),
    })
}

fn fill_missing_preview(target: &mut LinkPreview, fallback: LinkPreview) {
    if target.title.is_none() {
        target.title = fallback.title;
    }
    if target.description.is_none() {
        target.description = fallback.description;
    }
    if target.image.is_none() {
        target.image = fallback.image;
    }
    if target.favicon.is_none() {
        target.favicon = fallback.favicon;
    }
    if target.site_name.is_none() {
        target.site_name = fallback.site_name;
    }
}

fn is_x_status_url(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let is_x_host = matches!(
        host.as_str(),
        "x.com" | "www.x.com" | "mobile.x.com" | "twitter.com" | "www.twitter.com"
    );
    is_x_host
        && url
            .path_segments()
            .map(|segments| segments.collect::<Vec<_>>().windows(2).any(|pair| pair[0] == "status"))
            .unwrap_or(false)
}

async fn embed_best_favicon(
    client: &reqwest::Client,
    preview: &mut LinkPreview,
    page_url: &Url,
) {
    let mut candidates = Vec::new();
    if let Some(current) = preview.favicon.clone() {
        candidates.push(current);
    }
    for path in [
        "/favicon.ico",
        "/favicon.png",
        "/apple-touch-icon.png",
        "/apple-touch-icon-precomposed.png",
    ] {
        if let Ok(url) = page_url.join(path) {
            let value = url.to_string();
            if !candidates.contains(&value) {
                candidates.push(value);
            }
        }
    }

    let referer = page_url.as_str();
    for candidate in candidates {
        if candidate.starts_with("data:image/") {
            preview.favicon = Some(candidate);
            return;
        }
        if let Some(data) = fetch_as_data_url(client, &candidate, referer)
            .await
            .or(fetch_as_data_url(client, &candidate, "").await)
        {
            preview.favicon = Some(data);
            return;
        }
    }
    preview.favicon = None;
}

#[tauri::command]
async fn fetch_link_preview(url: String) -> Result<LinkPreview, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("empty url".into());
    }
    let parsed = Url::parse(trimmed).map_err(|e| e.to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("only http(s) urls are supported".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(8))
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 InfiniteCanvas/1.0",
        )
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(parsed.clone())
        .header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7")
        .send()
        .await;

    let mut final_url = parsed.clone();
    let mut preview = LinkPreview::default();
    if let Ok(resp) = response {
        if resp.status().is_success() {
            final_url = resp.url().clone();
            if let Ok(mut html) = resp.text().await {
                if html.len() > 600_000 {
                    html.truncate(600_000);
                }
                preview = parse_preview(&html, &final_url);
            }
        }
    }

    // X status pages expose a generic X share image to direct HTTP clients,
    // while Microlink resolves the actual post media. For those URLs the
    // provider image is authoritative rather than merely a missing-field
    // fallback. This keeps packaged output aligned with the browser build.
    let x_status = is_x_status_url(&final_url) || is_x_status_url(&parsed);
    if x_status {
        if let Some(mut provider) = fetch_microlink_preview(&client, &final_url).await {
            if provider.title.is_some() {
                preview.title = provider.title.take();
            }
            if provider.description.is_some() {
                preview.description = provider.description.take();
            }
            if provider.image.is_some() {
                preview.image = provider.image.take();
            }
            if provider.site_name.is_some() {
                preview.site_name = provider.site_name.take();
            }
            fill_missing_preview(&mut preview, provider);
        }
    } else if preview.title.is_none() || preview.description.is_none() || preview.image.is_none() {
        // In a packaged app, a frontend fetch to Microlink can be rejected
        // because its Origin is tauri://localhost. Do the fallback natively.
        if let Some(provider) = fetch_microlink_preview(&client, &final_url).await {
            fill_missing_preview(&mut preview, provider);
        }
    }

    if preview.title.is_none() && preview.description.is_none() && preview.image.is_none() {
        return Err("no link preview metadata found".into());
    }

    let referer = final_url.as_str().to_string();

    // Always try to embed OG image as data URL (WebView cannot load many CDNs directly)
    if let Some(img) = preview.image.clone() {
        if !img.starts_with("data:") {
            // Keep the original URL when proxying fails. Some WebViews can load
            // it directly, and discarding it here guarantees a placeholder.
            preview.image = fetch_as_data_url(&client, &img, &referer)
                .await
                .or(fetch_as_data_url(&client, &img, "").await)
                .or(Some(img));
        }
    }

    // X uses the same favicon collection and fallback path as every other
    // website; only its post image has special provider precedence.
    embed_best_favicon(&client, &mut preview, &final_url).await;

    Ok(preview)
}

/// Proxy any remote image to a data URL for the WebView.
#[tauri::command]
async fn proxy_image_data_url(url: String, referer: Option<String>) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("empty url".into());
    }
    if trimmed.starts_with("data:") {
        return Ok(trimmed.to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(8))
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 InfiniteCanvas/1.0",
        )
        .build()
        .map_err(|e| e.to_string())?;

    let ref_str = referer.unwrap_or_default();
    if let Some(data) = fetch_as_data_url(&client, trimmed, &ref_str).await {
        return Ok(data);
    }
    if !ref_str.is_empty() {
        if let Some(data) = fetch_as_data_url(&client, trimmed, "").await {
            return Ok(data);
        }
    }
    Err("failed to download image".into())
}

/// Hard-exit the process (avoids WebView close deadlocks).
#[tauri::command]
fn force_exit_app() {
    std::process::exit(0);
}

/// Return a project path passed by Windows (for Open With / file association).
#[tauri::command]
fn get_launch_file_path() -> Option<String> {
    std::env::args().skip(1).find_map(|arg| {
        let path = std::path::PathBuf::from(&arg);
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if path.is_file()
            && (extension.eq_ignore_ascii_case("icanvas")
                || extension.eq_ignore_ascii_case("json"))
        {
            Some(path.to_string_lossy().into_owned())
        } else {
            None
        }
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            fetch_link_preview,
            proxy_image_data_url,
            get_launch_file_path,
            force_exit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Infinite Canvas (Tauri)");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_x_and_twitter_status_urls() {
        assert!(is_x_status_url(&Url::parse(
            "https://x.com/Voxyz_ai/status/2076259556397572433?s=20"
        ).unwrap()));
        assert!(is_x_status_url(&Url::parse(
            "https://twitter.com/example/status/123"
        ).unwrap()));
        assert!(!is_x_status_url(&Url::parse("https://x.com/home").unwrap()));
    }
}

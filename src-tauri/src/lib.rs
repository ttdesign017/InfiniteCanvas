use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, ToSocketAddrs};

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
const MAX_PREVIEW_HTML_BYTES: usize = 600_000;
const MAX_PROVIDER_JSON_BYTES: usize = 2_000_000;
const PREVIEW_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 InfiniteCanvas/1.0";

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 0 && c == 0)
                || (a == 192 && b == 0 && c == 2)
                || (a == 192 && b == 168)
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113)
                || a >= 224)
        }
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(mapped));
            }
            let octets = ip.octets();
            !(ip.is_unspecified()
                || ip.is_loopback()
                || ip.is_multicast()
                || (octets[0] & 0xfe) == 0xfc
                || (octets[0] == 0xfe && (octets[1] & 0xc0) == 0x80)
                || octets[0..4] == [0x20, 0x01, 0x0d, 0xb8])
        }
    }
}

fn validate_public_http_url(url: &Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("only http(s) urls are supported".into());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "url has no host".to_string())?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".lan")
        || host.ends_with(".internal")
    {
        return Err("local network urls are not allowed".into());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if is_public_ip(ip) {
            Ok(())
        } else {
            Err("private or local network urls are not allowed".into())
        };
    }

    let port = url.port_or_known_default().unwrap_or(80);
    let addresses: Vec<_> = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| format!("unable to resolve url host: {e}"))?
        .collect();
    if addresses.is_empty() {
        return Err("url host resolved to no addresses".into());
    }
    if addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err("url host resolves to a private or local address".into());
    }
    Ok(())
}

fn build_safe_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 8 {
                return attempt.stop();
            }
            match validate_public_http_url(attempt.url()) {
                Ok(()) => attempt.follow(),
                Err(message) => attempt.error(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    message,
                )),
            }
        }))
        .user_agent(PREVIEW_USER_AGENT)
        .build()
        .map_err(|e| e.to_string())
}

fn safe_remote_fallback(value: String) -> Option<String> {
    let url = Url::parse(&value).ok()?;
    validate_public_http_url(&url).ok()?;
    Some(value)
}

async fn read_body_limited(
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Option<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return None;
    }
    let mut body = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or(0)
            .min(max_bytes as u64) as usize,
    );
    while let Some(chunk) = response.chunk().await.ok()? {
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    Some(body)
}

async fn read_body_prefix(mut response: reqwest::Response, max_bytes: usize) -> Option<Vec<u8>> {
    let mut body = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or(0)
            .min(max_bytes as u64) as usize,
    );
    while body.len() < max_bytes {
        let Some(chunk) = response.chunk().await.ok()? else {
            break;
        };
        let remaining = max_bytes - body.len();
        body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        if chunk.len() >= remaining {
            break;
        }
    }
    Some(body)
}

async fn read_json_limited(response: reqwest::Response) -> Option<serde_json::Value> {
    let body = read_body_limited(response, MAX_PROVIDER_JSON_BYTES).await?;
    serde_json::from_slice(&body).ok()
}

async fn response_has_at_least(mut response: reqwest::Response, min_bytes: usize) -> bool {
    if let Some(length) = response.content_length() {
        return length >= min_bytes as u64;
    }
    let mut received = 0usize;
    while let Ok(Some(chunk)) = response.chunk().await {
        received = received.saturating_add(chunk.len());
        if received >= min_bytes {
            return true;
        }
    }
    false
}

/// Download an image with page Referer (anti-hotlink) and return a data URL.
/// WebView often fails on raw og:image URLs (Referer / CDN blocks); data URLs always work.
async fn fetch_as_data_url(
    client: &reqwest::Client,
    image_url: &str,
    referer: &str,
) -> Option<String> {
    let parsed = Url::parse(image_url).ok()?;
    validate_public_http_url(&parsed).ok()?;

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

    let bytes = read_body_limited(resp, MAX_PREVIEW_IMAGE_BYTES).await?;
    if bytes.is_empty() {
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
    let json = read_json_limited(response).await?;
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
    extract_x_status_id(url).is_some()
}

fn is_x_host(host: &str) -> bool {
    matches!(
        host,
        "x.com"
            | "www.x.com"
            | "mobile.x.com"
            | "twitter.com"
            | "www.twitter.com"
            | "mobile.twitter.com"
            | "t.co"
    )
}

fn extract_x_status_id(url: &Url) -> Option<String> {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if !is_x_host(&host) {
        return None;
    }
    static RE_STATUS: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(?i)/status(?:es)?/(\d{1,25})(?:/|$)").unwrap());
    RE_STATUS
        .captures(url.path())
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

fn is_youtube_host(host: &str) -> bool {
    matches!(
        host,
        "youtube.com"
            | "www.youtube.com"
            | "m.youtube.com"
            | "music.youtube.com"
            | "youtu.be"
            | "www.youtu.be"
            | "youtube-nocookie.com"
            | "www.youtube-nocookie.com"
    ) || host.ends_with(".youtube.com")
}

fn extract_youtube_video_id(url: &Url) -> Option<String> {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if !is_youtube_host(&host) {
        return None;
    }

    let valid = |id: &str| {
        id.len() >= 6
            && id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    };

    if host == "youtu.be" || host == "www.youtu.be" {
        if let Some(id) = url.path_segments().and_then(|mut s| s.next()) {
            if valid(id) {
                return Some(id.to_string());
            }
        }
        return None;
    }

    if let Some(v) = url
        .query_pairs()
        .find(|(k, _)| k == "v")
        .map(|(_, v)| v.into_owned())
    {
        if valid(&v) {
            return Some(v);
        }
    }

    let segs: Vec<&str> = url
        .path_segments()
        .map(|s| s.collect())
        .unwrap_or_default();
    if segs.len() >= 2 {
        let kind = segs[0].to_ascii_lowercase();
        if matches!(kind.as_str(), "shorts" | "embed" | "live" | "v") && valid(segs[1]) {
            return Some(segs[1].to_string());
        }
    }
    None
}

/// YouTube oEmbed + CDN thumbnail — does not rely on fragile HTML OG scrape.
async fn fetch_youtube_preview(client: &reqwest::Client, url: &Url) -> Option<LinkPreview> {
    let video_id = extract_youtube_video_id(url)?;
    let watch = format!("https://www.youtube.com/watch?v={video_id}");
    let oembed = format!(
        "https://www.youtube.com/oembed?url={}&format=json",
        urlencoding_encode(&watch)
    );

    let mut title = None;
    let mut author = None;
    if let Ok(resp) = client.get(&oembed).send().await {
        if resp.status().is_success() {
            if let Some(json) = read_json_limited(resp).await {
                title = json
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                author = json
                    .get("author_name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
            }
        }
    }

    // Prefer highest-res thumbnail that downloads successfully
    let thumb_candidates = [
        format!("https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"),
        format!("https://i.ytimg.com/vi/{video_id}/sddefault.jpg"),
        format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"),
        format!("https://img.youtube.com/vi/{video_id}/hqdefault.jpg"),
    ];
    let mut image = None;
    for candidate in &thumb_candidates {
        if let Ok(resp) = client.get(candidate).send().await {
            if resp.status().is_success() {
                if response_has_at_least(resp, 8_001).await {
                    // maxresdefault sometimes returns a tiny grey 120×90 placeholder
                    image = Some(candidate.clone());
                    break;
                }
            }
        }
    }
    if image.is_none() {
        image = Some(thumb_candidates[2].clone());
    }

    let description = author
        .as_ref()
        .map(|a| format!("{a} · YouTube"))
        .or_else(|| Some("YouTube".into()));

    Some(LinkPreview {
        title: title.or_else(|| Some(format!("YouTube · {video_id}"))),
        description,
        image,
        favicon: Some("https://www.youtube.com/s/desktop/favicon.ico".into()),
        site_name: Some("YouTube".into()),
    })
}

/// Minimal URL-encode for query values (oEmbed).
fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// FxTwitter / VxTwitter — X blocks direct HTML scrapers and Microlink often
/// returns success with no post image.
async fn fetch_x_preview(client: &reqwest::Client, url: &Url) -> Option<LinkPreview> {
    let status_id = extract_x_status_id(url)?;
    let endpoints = [
        format!("https://api.fxtwitter.com/status/{status_id}"),
        format!("https://api.vxtwitter.com/Twitter/status/{status_id}"),
    ];

    for endpoint in endpoints {
        let Ok(resp) = client.get(&endpoint).send().await else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        let Some(json) = read_json_limited(resp).await else {
            continue;
        };

        let tweet = json
            .get("tweet")
            .cloned()
            .unwrap_or_else(|| json.clone());

        let text = tweet
            .get("text")
            .or_else(|| tweet.get("full_text"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let author = tweet
            .get("author")
            .or_else(|| tweet.get("user"))
            .cloned()
            .unwrap_or(serde_json::Value::Null);

        let screen_name = author
            .get("screen_name")
            .or_else(|| author.get("screenName"))
            .or_else(|| tweet.get("user_screen_name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .trim_start_matches('@')
            .to_string();

        let display_name = author
            .get("name")
            .or_else(|| tweet.get("user_name"))
            .and_then(|v| v.as_str())
            .unwrap_or(screen_name.as_str())
            .trim()
            .to_string();

        let mut avatar = author
            .get("avatar_url")
            .or_else(|| author.get("profile_image_url_https"))
            .or_else(|| tweet.get("user_profile_image_url"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if let Some(ref a) = avatar {
            // Prefer higher-res avatar for the card thumb fallback
            let upgraded = a
                .replace("_normal.", "_400x400.")
                .replace("_bigger.", "_400x400.")
                .replace("_mini.", "_400x400.")
                .replace("_200x200.", "_400x400.");
            avatar = Some(upgraded);
        }

        let banner = author
            .get("banner_url")
            .or_else(|| tweet.get("user_banner_url"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let mut image: Option<String> = None;
        if let Some(media) = tweet.get("media") {
            if let Some(photos) = media.get("photos").and_then(|v| v.as_array()) {
                if let Some(url) = photos
                    .first()
                    .and_then(|p| p.get("url"))
                    .and_then(|v| v.as_str())
                {
                    image = Some(url.to_string());
                }
            }
            if image.is_none() {
                if let Some(videos) = media.get("videos").and_then(|v| v.as_array()) {
                    if let Some(url) = videos
                        .first()
                        .and_then(|p| p.get("thumbnail_url").or_else(|| p.get("url")))
                        .and_then(|v| v.as_str())
                    {
                        image = Some(url.to_string());
                    }
                }
            }
            if image.is_none() {
                if let Some(all) = media.get("all").and_then(|v| v.as_array()) {
                    for item in all {
                        if let Some(url) = item
                            .get("thumbnail_url")
                            .or_else(|| item.get("url"))
                            .and_then(|v| v.as_str())
                        {
                            image = Some(url.to_string());
                            break;
                        }
                    }
                }
            }
        }
        if image.is_none() {
            if let Some(urls) = tweet.get("mediaURLs").and_then(|v| v.as_array()) {
                if let Some(url) = urls.first().and_then(|v| v.as_str()) {
                    image = Some(url.to_string());
                }
            }
        }
        if image.is_none() {
            if let Some(ext) = tweet.get("media_extended").and_then(|v| v.as_array()) {
                for item in ext {
                    if let Some(url) = item
                        .get("thumbnail_url")
                        .or_else(|| item.get("url"))
                        .and_then(|v| v.as_str())
                    {
                        image = Some(url.to_string());
                        break;
                    }
                }
            }
        }

        // X Articles put the cover under `article`, while `media` stays null.
        // e.g. https://x.com/LexnLin/status/2076422557180608888
        let mut article_title: Option<String> = None;
        let mut article_desc: Option<String> = None;
        if let Some(article) = tweet.get("article") {
            article_title = article
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            article_desc = article
                .get("preview_text")
                .or_else(|| article.get("description"))
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            if image.is_none() {
                // vxtwitter: article.image
                if let Some(url) = article.get("image").and_then(|v| v.as_str()) {
                    image = Some(url.to_string());
                }
            }
            if image.is_none() {
                // fxtwitter: article.cover_media.media_info.original_img_url
                if let Some(url) = article
                    .get("cover_media")
                    .and_then(|c| c.get("media_info"))
                    .and_then(|m| {
                        m.get("original_img_url")
                            .or_else(|| m.get("original_img_url_https"))
                    })
                    .and_then(|v| v.as_str())
                {
                    image = Some(url.to_string());
                }
            }
        }

        // Text-only posts: still show author banner/avatar so the card isn't blank
        if image.is_none() {
            image = banner.or(avatar.clone());
        }

        let author_label = if !display_name.is_empty() && !screen_name.is_empty() {
            format!("{display_name} (@{screen_name})")
        } else if !display_name.is_empty() {
            display_name
        } else if !screen_name.is_empty() {
            format!("@{screen_name}")
        } else {
            "Post on X".into()
        };

        let has_article_title = article_title.is_some();
        let title = article_title.unwrap_or_else(|| author_label.clone());

        let description = if let Some(d) = article_desc {
            d.chars().take(280).collect()
        } else if text.is_empty() {
            if has_article_title {
                author_label
            } else {
                "X".into()
            }
        } else {
            text.chars().take(280).collect()
        };

        return Some(LinkPreview {
            title: Some(title),
            description: Some(description),
            image,
            favicon: Some("https://x.com/favicon.ico".into()),
            site_name: Some("X".into()),
        });
    }

    None
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
    validate_public_http_url(&parsed)?;

    let client = build_safe_client(12)?;

    let mut final_url = parsed.clone();
    let mut preview = LinkPreview::default();

    // Site-native providers first: X/YouTube block or starve generic HTML scrapes.
    if extract_youtube_video_id(&parsed).is_some() {
        if let Some(yt) = fetch_youtube_preview(&client, &parsed).await {
            preview = yt;
        }
    } else if is_x_status_url(&parsed) {
        if let Some(x) = fetch_x_preview(&client, &parsed).await {
            preview = x;
        }
    }

    // Generic HTML OG scrape (works for most other sites; X often closes the socket)
    if preview.image.is_none() || preview.title.is_none() {
        let response = client
            .get(parsed.clone())
            .header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
            .header("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7")
            .send()
            .await;

        if let Ok(resp) = response {
            if resp.status().is_success() {
                final_url = resp.url().clone();
                if let Some(bytes) = read_body_prefix(resp, MAX_PREVIEW_HTML_BYTES).await {
                    let html = String::from_utf8_lossy(&bytes);
                    let scraped = parse_preview(&html, &final_url);
                    fill_missing_preview(&mut preview, scraped);
                }
            }
        }
    }

    // Microlink as last metadata filler (not authoritative for X media)
    if preview.title.is_none() || preview.description.is_none() || preview.image.is_none() {
        if let Some(provider) = fetch_microlink_preview(&client, &final_url).await {
            fill_missing_preview(&mut preview, provider);
        }
        // X: if microlink still has no image, retry FxTwitter after scrape
        if preview.image.is_none() && (is_x_status_url(&final_url) || is_x_status_url(&parsed)) {
            if let Some(x) = fetch_x_preview(&client, &parsed).await {
                fill_missing_preview(&mut preview, x);
            }
        }
    }

    if preview.title.is_none() && preview.description.is_none() && preview.image.is_none() {
        return Err("no link preview metadata found".into());
    }

    let referer = final_url.as_str().to_string();

    // Always try to embed OG image as data URL (WebView cannot load many CDNs directly)
    if let Some(img) = preview.image.clone() {
        if !img.starts_with("data:") {
            // Media CDNs (ytimg / twimg) often reject page Referers — empty first.
            let img_host = Url::parse(&img)
                .ok()
                .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
                .unwrap_or_default();
            let media_cdn = img_host.contains("ytimg.com")
                || img_host.contains("twimg.com")
                || img_host.contains("youtube.com")
                || img_host.contains("ggpht.com");

            preview.image = if media_cdn {
                fetch_as_data_url(&client, &img, "")
                    .await
                    .or(fetch_as_data_url(&client, &img, &referer).await)
                    .or_else(|| safe_remote_fallback(img))
            } else {
                fetch_as_data_url(&client, &img, &referer)
                    .await
                    .or(fetch_as_data_url(&client, &img, "").await)
                    .or_else(|| safe_remote_fallback(img))
            };
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

    let client = build_safe_client(15)?;

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
        assert!(!is_x_status_url(&Url::parse(
            "https://x.com/example/status/123abc"
        ).unwrap()));
    }

    #[test]
    fn blocks_private_and_local_preview_targets() {
        for value in [
            "http://127.0.0.1/admin",
            "http://10.0.0.2/",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]/",
            "http://localhost/",
        ] {
            let url = Url::parse(value).unwrap();
            assert!(validate_public_http_url(&url).is_err(), "allowed {value}");
        }
        assert!(validate_public_http_url(&Url::parse("https://8.8.8.8/").unwrap()).is_ok());
    }
}

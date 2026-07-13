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
        if let Some(prop) = map.get("property").or_else(|| map.get("name")) {
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
        .or_else(|| og.get("og:image"))
        .or_else(|| og.get("twitter:image"))
        .or_else(|| og.get("twitter:image:src"))
        .and_then(|href| abs_url(page_url, href));

    let site_name = og
        .get("og:site_name")
        .cloned()
        .map(|s| clean_text(&s));

    let mut favicon: Option<String> = None;
    let mut best_icon_score = -1i32;
    for cap in RE_LINK_ICON.captures_iter(html) {
        let attrs = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let map = attr_map(attrs);
        let rel = map
            .get("rel")
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
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

    if favicon.is_none() {
        if let Ok(icon) = page_url.join("/favicon.ico") {
            favicon = Some(icon.to_string());
        }
    }

    LinkPreview {
        title,
        description,
        image,
        favicon,
        site_name,
    }
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

    let resp = client
        .get(parsed.clone())
        .header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let final_url = resp.url().clone();
    let mut html = resp.text().await.map_err(|e| e.to_string())?;
    if html.len() > 600_000 {
        html.truncate(600_000);
    }

    Ok(parse_preview(&html, &final_url))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![fetch_link_preview])
        .run(tauri::generate_context!())
        .expect("error while running Infinite Canvas (Tauri)");
}

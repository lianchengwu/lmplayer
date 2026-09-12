use serde_json::{json, Value};

use crate::http::{obj, Call, Response};
use crate::types::{SearchKind, Song};
use crate::{Client, Result};

#[derive(Debug)]
pub struct SearchPage {
    pub kind: SearchKind,
    pub total: i64,
    pub songs: Vec<Song>,
    pub response: Response,
}

pub struct SearchRequest<'a> {
    client: &'a Client,
    keyword: String,
    page: u32,
    pagesize: u32,
    kind: SearchKind,
}

impl Client {
    pub fn search(&self, keyword: impl Into<String>) -> SearchRequest<'_> {
        SearchRequest {
            client: self,
            keyword: keyword.into(),
            page: 1,
            pagesize: 30,
            kind: SearchKind::Song,
        }
    }

    pub async fn search_hot(&self) -> Result<Response> {
        self.execute(
            Call::get("/api/v3/search/hot_tab")
                .query("navid", 1)
                .query("plat", 2)
                .router("msearch.kugou.com"),
        )
        .await
    }

    pub async fn search_default(&self) -> Result<Response> {
        let userid: i64 = self
            .session()
            .user_id()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let vip_type = self
            .session()
            .vip_type()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(65530);
        self.execute(
            Call::post("/searchnofocus/v1/search_no_focus_word")
                .query("clientver", 12329)
                .json(json!({
                    "plat": 0,
                    "userid": userid,
                    "tags": "{}",
                    "vip_type": vip_type,
                    "m_type": 0,
                    "own_ads": {},
                    "ability": "3",
                    "sources": [],
                    "bitmap": 2,
                    "mode": "normal",
                }))?,
        )
        .await
    }

    pub async fn search_complex(&self, keyword: impl Into<String>) -> Result<Response> {
        self.execute(
            Call::get("/v6/search/complex")
                .base("https://complexsearch.kugou.com")
                .query("platform", "AndroidFilter")
                .query("keyword", keyword.into())
                .query("page", 1)
                .query("pagesize", 30)
                .query("cursor", 0),
        )
        .await
    }

    pub async fn search_suggest(&self, keyword: impl Into<String>) -> Result<Response> {
        self.execute(
            Call::get("/v2/getSearchTip")
                .query("keyword", keyword.into())
                .query("AlbumTipCount", 10)
                .query("CorrectTipCount", 10)
                .query("MVTipCount", 10)
                .query("MusicTipCount", 10)
                .query("radiotip", 1)
                .router("searchtip.kugou.com"),
        )
        .await
    }
}

impl SearchRequest<'_> {
    pub fn page(mut self, page: u32) -> Self {
        self.page = page.max(1);
        self
    }

    pub fn pagesize(mut self, n: u32) -> Self {
        self.pagesize = n.max(1);
        self
    }

    pub fn kind(mut self, kind: SearchKind) -> Self {
        self.kind = kind;
        self
    }

    pub async fn send(self) -> Result<SearchPage> {
        let version = if self.kind == SearchKind::Song { "v3" } else { "v1" };
        let res = self
            .client
            .execute(
                Call::get(format!("/{version}/search/{}", self.kind.as_str()))
                    .queries(obj(json!({
                        "albumhide": 0,
                        "iscorrection": 1,
                        "keyword": self.keyword,
                        "nocollect": 0,
                        "page": self.page,
                        "pagesize": self.pagesize,
                        "platform": "AndroidFilter",
                    })))
                    .router("complexsearch.kugou.com"),
            )
            .await?;
        Ok(parse_search_page(self.kind, res))
    }
}

fn parse_search_page(kind: SearchKind, response: Response) -> SearchPage {
    let data = response.data();
    let total = data
        .get("total")
        .and_then(|v| v.as_i64())
        .or_else(|| data.get("total").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()))
        .unwrap_or(0);
    let lists = data
        .get("lists")
        .or_else(|| data.get("list"))
        .cloned()
        .unwrap_or(Value::Array(vec![]));
    let songs = match lists {
        Value::Array(arr) => arr
            .into_iter()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect(),
        _ => Vec::new(),
    };
    SearchPage {
        kind,
        total,
        songs,
        response,
    }
}

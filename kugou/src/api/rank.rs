use crate::http::{Call, Response};
use crate::{Client, Result};

impl Client {
    pub async fn rank_list(&self) -> Result<Response> {
        self.execute(
            Call::get("/ocean/v6/rank/list")
                .query("plat", 2)
                .query("withsong", 1)
                .query("parentid", 0),
        )
        .await
    }

    pub async fn rank_info(&self, rank_id: impl Into<serde_json::Value>) -> Result<Response> {
        self.execute(
            Call::get("/ocean/v6/rank/info")
                .query("rank_cid", 0)
                .query("rankid", rank_id.into())
                .query("with_album_img", 1)
                .query("zone", ""),
        )
        .await
    }

    pub async fn rank_top(&self) -> Result<Response> {
        self.execute(Call::get("/ocean/v6/rank/top")).await
    }
}

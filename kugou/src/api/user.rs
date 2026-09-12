use serde_json::json;

use crate::http::{Call, Response};
use crate::proto::{now_s, rsa_raw_encrypt_value};
use crate::{Client, Result};

impl Client {
    pub async fn user_detail(&self) -> Result<Response> {
        let session = self.session();
        let token = session.token().unwrap_or("").to_string();
        let userid: i64 = session.user_id().and_then(|s| s.parse().ok()).unwrap_or(0);
        let clienttime = now_s();
        let pk = rsa_raw_encrypt_value(
            &json!({ "token": token, "clienttime": clienttime }),
            self.rsa_pem(),
        )?
        .to_uppercase();
        self.execute(
            Call::post("/v3/get_my_info")
                .query("plat", 1)
                .json(json!({
                    "visit_time": clienttime,
                    "usertype": 1,
                    "p": pk,
                    "userid": userid,
                }))?
                .router("usercenter.kugou.com"),
        )
        .await
    }
}

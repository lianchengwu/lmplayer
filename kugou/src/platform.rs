/// Official app vs 概念版. Tokens and appid are not interchangeable.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Platform {
    #[default]
    Standard,
    Lite,
}

impl Platform {
    pub fn appid(self) -> i64 {
        match self {
            Self::Standard => 1005,
            Self::Lite => 3116,
        }
    }

    pub fn clientver(self) -> i64 {
        match self {
            Self::Standard => 20489,
            Self::Lite => 11440,
        }
    }

    pub(crate) fn rsa_pem(self) -> &'static str {
        match self {
            Self::Standard => crate::proto::PUBLIC_RSA_KEY,
            Self::Lite => crate::proto::PUBLIC_LITE_RSA_KEY,
        }
    }
}

pub(crate) const SRCAPPID: i64 = 2919;
pub(crate) const DEFAULT_BASE_URL: &str = "https://gateway.kugou.com";
pub(crate) const USER_AGENT: &str = "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi";
pub(crate) const KG_THASH: &str = "5d816a0";
pub(crate) const KG_RF: &str = "B9EDA08A64250DEFFBCADDEE00F8F25F";
pub(crate) const DEFAULT_MAC: &str = "02:00:00:00:00:00";

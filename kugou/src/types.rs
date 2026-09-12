use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SearchKind {
    #[default]
    Song,
    Album,
    Author,
    Special,
    Lyric,
    Mv,
}

impl SearchKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Song => "song",
            Self::Album => "album",
            Self::Author => "author",
            Self::Special => "special",
            Self::Lyric => "lyric",
            Self::Mv => "mv",
        }
    }
}

/// 私人 FM / 猜你喜欢. `remain_songcnt > 4` 时服务端不返回新歌.
#[derive(Clone, Debug, Default)]
pub struct PersonalFmParams {
    pub mode: String,
    pub action: String,
    pub song_pool_id: i64,
    pub remain_songcnt: i64,
    pub is_overplay: bool,
    pub hash: String,
    pub songid: String,
    pub playtime: i64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Quality {
    P128,
    P320,
    Flac,
    High,
    Super,
    Magic(String),
    Other(String),
}

impl Quality {
    pub fn as_str(&self) -> &str {
        match self {
            Self::P128 => "128",
            Self::P320 => "320",
            Self::Flac => "flac",
            Self::High => "high",
            Self::Super => "super",
            Self::Magic(s) | Self::Other(s) => s,
        }
    }

    pub fn from_param(q: &str) -> Self {
        match q {
            "" | "128" => Self::P128,
            "320" => Self::P320,
            "flac" => Self::Flac,
            "high" => Self::High,
            "super" => Self::Super,
            "piano" | "acappella" | "subwoofer" | "ancient" | "dj" | "surnay" => {
                Self::Magic(format!("magic_{q}"))
            }
            other => Self::Other(other.to_string()),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Song {
    #[serde(rename = "SongName", alias = "songname", alias = "audio_name", default, deserialize_with = "de_stringish")]
    pub name: String,
    #[serde(rename = "SingerName", alias = "singername", alias = "author_name", default, deserialize_with = "de_stringish")]
    pub singer: String,
    #[serde(rename = "FileHash", alias = "hash", alias = "filehash", default, deserialize_with = "de_stringish")]
    pub hash: String,
    #[serde(rename = "HQFileHash", alias = "hqhash", default, deserialize_with = "de_stringish")]
    pub hq_hash: String,
    #[serde(rename = "SQFileHash", alias = "sqhash", default, deserialize_with = "de_stringish")]
    pub sq_hash: String,
    #[serde(rename = "AlbumID", alias = "album_id", default, deserialize_with = "de_stringish")]
    pub album_id: String,
    #[serde(rename = "AlbumName", alias = "album_name", default, deserialize_with = "de_stringish")]
    pub album: String,
    #[serde(rename = "Duration", alias = "duration", default, deserialize_with = "de_i64")]
    pub duration: i64,
    #[serde(rename = "MixSongID", alias = "album_audio_id", alias = "mixsongid", default)]
    pub album_audio_id: Value,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

impl Song {
    pub fn album_audio_id_i64(&self) -> i64 {
        match &self.album_audio_id {
            serde_json::Value::Number(n) => n.as_i64().unwrap_or(0),
            serde_json::Value::String(s) => s.parse().unwrap_or(0),
            _ => 0,
        }
    }

    pub fn album_id_i64(&self) -> i64 {
        self.album_id.parse().unwrap_or(0)
    }
}

fn de_stringish<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<String, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Null => String::new(),
        Value::String(s) => s,
        other => crate::proto::value_query(&other),
    })
}

fn de_i64<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<i64, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Null => 0,
        Value::Number(n) => n.as_i64().unwrap_or(0),
        Value::String(s) => s.parse().unwrap_or(0),
        _ => 0,
    })
}

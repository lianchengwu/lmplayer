//! Wire protocol. Not part of the public SDK surface.

mod aes;
mod cookie;
mod hash;
mod id;
mod lyrics;
mod rsa;
mod sign;
mod simulate;

pub(crate) use aes::{aes_decrypt, aes_encrypt_value};
pub(crate) use cookie::{parse_cookie_header, parse_set_cookie};
pub(crate) use hash::md5_str;
pub(crate) use id::{
    calculate_mid, generate_webgl_hash, get_guid, is_uuid_v4, md5_guid_like, now_ms, now_s, random_string,
};
pub(crate) use rsa::{rsa_raw_encrypt_value, PUBLIC_LITE_RSA_KEY, PUBLIC_RSA_KEY};
pub(crate) use sign::{
    sign_key, sign_params_key, signature_android_params, signature_register_params, signature_web_params,
    value_query,
};
pub(crate) use simulate::generate_simulate;

pub use lyrics::{decode_krc, decode_krc_base64};

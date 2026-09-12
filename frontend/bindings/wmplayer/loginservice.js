import { cmd } from '../invoke.js'

export const SendCaptcha = cmd('send_captcha')
export const LoginWithPhone = cmd('login_with_phone')
export const GenerateQRKey = cmd('generate_qr_key')
export const CreateQRCode = cmd('create_qr_code')
export const CheckQRStatus = cmd('check_qr_status')
export const GetUserDetail = cmd('get_user_detail')
export const GetVipDetail = cmd('get_vip_detail')
export const CheckLoginStatus = cmd('check_login_status')
export const ClaimDailyVip = cmd('claim_daily_vip')
export const Logout = cmd('logout')

export const LoginService = {
    SendCaptcha,
    LoginWithPhone,
    GenerateQRKey,
    CreateQRCode,
    CheckQRStatus,
    GetUserDetail,
    GetVipDetail,
    CheckLoginStatus,
    ClaimDailyVip,
    Logout,
}

import { cmd } from '../invoke.js'

export const GetSongUrl = cmd('get_song_url')
export const GetPersonalFMWithParams = cmd('get_personal_fm_with_params')
export const GetPersonalFMAdvanced = cmd('get_personal_fm_advanced')
export const ReportFMAction = cmd('report_fm_action')
export const GetDailyRecommend = cmd('get_daily_recommend')
export const GetAIRecommend = cmd('get_ai_recommend')

export const HomepageService = {
    GetSongUrl,
    GetPersonalFMWithParams,
    GetPersonalFMAdvanced,
    ReportFMAction,
    GetDailyRecommend,
    GetAIRecommend,
}

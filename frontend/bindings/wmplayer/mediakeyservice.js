import { cmd } from '../invoke.js'

export const GetMediaKeyStatus = cmd('get_media_key_status')
export const UpdateMPRISPlaybackStatus = cmd('update_mpris_playback_status')
export const UpdateMPRISMetadata = cmd('update_mpris_metadata')
export const UpdateMPRISVolume = cmd('update_mpris_volume')
export const UpdateMPRISPosition = cmd('update_mpris_position')
export const SetPlaybackState = cmd('set_playback_state')
export const IsSleepInhibited = cmd('is_sleep_inhibited')

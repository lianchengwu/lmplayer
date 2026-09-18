import { cmd } from '../invoke.js'

export const GetCachedURL = cmd('get_cached_url')
export const CacheAudioFile = cmd('cache_audio_file')
export const UpdateCurrentLyrics = cmd('update_current_lyrics')
export const SetEnabled = cmd('set_osd_enabled')
export const IsEnabled = cmd('is_osd_enabled')
export const ToggleOSDLock = cmd('toggle_osd_lock')
export const SetOSDLocked = cmd('set_osd_locked')
export const IsOSDLocked = cmd('is_osd_locked')
export const SetOSDColor = cmd('set_osd_color')
export const GetOSDColor = cmd('get_osd_color')

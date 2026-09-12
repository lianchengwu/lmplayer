import { cmd } from '../invoke.js'

export const GetPlaylist = cmd('get_playlist')
export const SetPlaylist = cmd('set_playlist')
export const AddToPlaylist = cmd('add_to_playlist')
export const SetCurrentIndex = cmd('set_current_index')
export const UpdatePlayMode = cmd('update_play_mode')
export const GetNextSong = cmd('get_next_song')
export const GetPreviousSong = cmd('get_previous_song')
export const ClearPlaylist = cmd('clear_playlist')

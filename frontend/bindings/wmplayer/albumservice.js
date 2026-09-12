import { cmd } from '../invoke.js'

export const GetAlbumDetail = cmd('get_album_detail')
export const GetAlbumSongs = cmd('get_album_songs')
export const GetPlaylistDetail = cmd('get_playlist_detail')
export const GetPlaylistSongs = cmd('get_playlist_songs_album')

export const AlbumService = { GetAlbumDetail, GetAlbumSongs, GetPlaylistDetail, GetPlaylistSongs }

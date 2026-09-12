import { cmd } from '../invoke.js'

export const AddFavorite = cmd('add_favorite')
export const GetUserPlaylists = cmd('get_user_playlists')
export const GetPlaylistSongs = cmd('get_favorite_playlist_songs')
export const GetFavoriteSongsForAI = cmd('get_favorite_playlist_songs')

export const FavoritesService = { AddFavorite, GetUserPlaylists, GetPlaylistSongs, GetFavoriteSongsForAI }

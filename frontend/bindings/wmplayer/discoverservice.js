import { cmd } from '../invoke.js'

export const GetNewSongs = cmd('get_new_songs')
export const GetNewAlbums = cmd('get_new_albums')
export const GetRecommendSongs = cmd('get_recommend_songs')

export const DiscoverService = { GetNewSongs, GetNewAlbums, GetRecommendSongs }

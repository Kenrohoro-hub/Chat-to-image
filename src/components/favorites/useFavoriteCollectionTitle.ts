import { getFavoriteCollectionLabel, t } from '../../lib/i18n'
import { useStore } from '../../store'
import { ALL_FAVORITES_COLLECTION_ID, DEFAULT_FAVORITE_COLLECTION_NAME } from '../../lib/favoriteState'

export function useFavoriteCollectionTitle() {
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const collections = useStore((s) => s.favoriteCollections)
  if (!activeFavoriteCollectionId) return ''
  if (activeFavoriteCollectionId === ALL_FAVORITES_COLLECTION_ID) return t('全部', 'All')
  const collection = collections.find((item) => item.id === activeFavoriteCollectionId)
  return collection ? getFavoriteCollectionLabel(collection) : t(DEFAULT_FAVORITE_COLLECTION_NAME, 'Default')
}

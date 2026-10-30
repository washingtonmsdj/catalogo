import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

type CollectionActions = {
  collectionsOpen: boolean
  setCollectionsOpen: Dispatch<SetStateAction<boolean>>
}

const CollectionActionsContext = createContext<CollectionActions | null>(null)

/** Single in-memory owner of the collections modal, shared by dock and header. */
export function CollectionActionsProvider({ children }: { children: ReactNode }) {
  const [collectionsOpen, setCollectionsOpen] = useState(false)
  return (
    <CollectionActionsContext.Provider value={{ collectionsOpen, setCollectionsOpen }}>
      {children}
    </CollectionActionsContext.Provider>
  )
}

export function useCollectionActions(): CollectionActions {
  const context = useContext(CollectionActionsContext)
  if (!context) throw new Error('Collection actions must be used under CollectionActionsProvider')
  return context
}

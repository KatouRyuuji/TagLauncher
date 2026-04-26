export interface Item {
  id: number;
  name: string;
  path: string;
  type: "folder" | "image" | "exe" | "bat" | "ps1";
  icon_path?: string | null;
  created_at: string;
  last_used_at?: string;
  is_favorite: boolean;
}

export interface Cabinet {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface ItemWithTags extends Item {
  tags: Tag[];
}

export interface ItemViewProps {
  items: ItemWithTags[];
  tags: Tag[];
  cabinets: Cabinet[];
  loading: boolean;
  currentCabinetId: number | null;
  onLaunch: (id: number) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  onSetTags: (itemId: number, tagIds: number[]) => Promise<void>;
  onSetManyTags: (changes: Array<{ itemId: number; tagIds: number[] }>) => Promise<void>;
  onAddTagToItem: (itemId: number, tagId: number) => Promise<void>;
  onRemoveTagFromItem: (itemId: number, tagId: number) => Promise<void>;
  onAddNewTagToItem: (itemId: number, tagName: string, baseTagIds?: number[]) => Promise<number[]>;
  onToggleFavorite: (id: number) => Promise<void>;
  onAddItemToCabinet: (cabinetId: number, itemId: number) => Promise<void>;
  onAddItemsToCabinet: (cabinetId: number, itemIds: number[]) => Promise<void>;
  onRemoveItemFromCabinet: (cabinetId: number, itemId: number) => Promise<void>;
  onRemoveItemsFromCabinet: (cabinetId: number, itemIds: number[]) => Promise<void>;
  onClearCurrentFilter: (itemId: number) => Promise<void>;
  onRequestRemoveFromApp: (itemId: number) => Promise<void>;
  onUpdateThumbnail: (itemId: number, iconPath: string | null) => Promise<void>;
  selectedItemIds: number[];
  onSelectItems: (itemIds: number[]) => void;
}

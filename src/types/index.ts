export interface Item {
  id: number;
  name: string;
  path: string;
  type: "folder" | "image" | "audio" | "exe" | "bat" | "ps1";
  icon_path?: string | null;
  created_at: string;
  last_used_at?: string;
  is_favorite: boolean;
  /** 对象文件当前是否丢失（删除/离线/跨盘移动且无法重定位）。path 为最近已知位置。 */
  is_missing?: boolean;
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

/** 标签父子关系边（DAG，多继承）：parent 是 child 的超集。 */
export interface TagRelation {
  parentId: number;
  childId: number;
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
  onSetTags: (itemId: number, tagIds: number[]) => Promise<void>;
  onSetManyTags: (changes: Array<{ itemId: number; tagIds: number[] }>) => Promise<void>;
  onRemoveTagFromItem: (itemId: number, tagId: number) => Promise<void>;
  onAddNewTagToItem: (itemId: number, tagName: string, baseTagIds?: number[]) => Promise<number[]>;
  /** 回收标签编辑器取消时未落库的新建空标签（避免点取消却已写入 DB 的残留） */
  onRecycleNewTags?: (tagIds: number[]) => Promise<void>;
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
  /** 整个对象库为空（非筛选导致的空） */
  libraryEmpty?: boolean;
  onClearFilters?: () => void;
}

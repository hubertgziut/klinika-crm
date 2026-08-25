import type { User } from "./api";

export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface Project {
  id: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  status: "active" | "archived" | "done";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  doneCount: number;
  branchCount: number;
}

export interface Branch {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  createdBy: string;
  createdAt: string;
  taskCount: number;
  doneCount: number;
}

export interface BranchNode extends Branch {
  children: BranchNode[];
}

export interface TaskAssignee {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
}

export interface Task {
  id: string;
  projectId: string;
  branchId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  createdBy: string;
  startDate: string | null;
  dueDate: string | null;
  position: number;
  aiSource: unknown;
  createdAt: string;
  updatedAt: string;
  assignee: TaskAssignee | null;
  creator: { id: string; name: string; avatarColor: string };
}

export interface TaskComment {
  id: string;
  taskId: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; avatarColor: string };
}

export interface TaskActivity {
  id: string;
  taskId: string;
  action: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string; avatarColor: string };
}

export interface ProjectDetail extends Project {
  branches: Branch[];
  branchTree: BranchNode[];
}

// ===== Komunikator =====
export interface ChatMember {
  id: string;
  name: string;
  avatarColor: string;
}

export interface ChatLastMessage {
  body: string;
  createdAt: string;
  author: { id: string; name: string };
}

export interface Channel {
  id: string;
  name: string;
  topic: string;
  kind: "channel" | "dm";
  createdAt: string;
  lastMessage: ChatLastMessage | null;
  unread: number;
  members: ChatMember[];
  /** czy bieżący użytkownik jest członkiem kanału (tylko kanały publiczne) */
  isMember?: boolean;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  userId: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; avatarColor: string };
}

// ===== Tabele i dokumenty =====
export type ColumnType = "text" | "number" | "date";

export interface TableColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export interface TableSummary {
  id: string;
  name: string;
  projectId: string | null;
  rowCount: number;
  colCount: number;
  updatedAt: string;
}

export interface TableRowData {
  id: string;
  position: number;
  cells: Record<string, string>;
}

export interface TableFull {
  id: string;
  name: string;
  projectId: string | null;
  columns: TableColumn[];
  rows: TableRowData[];
}

export interface DocSummary {
  id: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export interface UploadInfo {
  id: string;
  filename: string;
  storedName: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface DocFull extends DocSummary {
  content: string;
  uploads: UploadInfo[];
}

// ===== Inwentarz, koszyki, zamówienia (Faza 5) =====
export type CartStatus = "new" | "in_progress" | "ordered" | "delivered";
export type OrderStatus = "placed" | "shipped" | "delivered" | "cancelled";

export interface Product {
  id: string;
  name: string;
  category: string;
  unit: string;
  supplier: string;
  supplierUrl: string;
  price: number;
  sku: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  quantity: number;
  minQuantity: number;
  location: string;
  inventoryUpdatedAt: string | null;
  low: boolean;
}

export interface CartSummary {
  id: string;
  name: string;
  supplier: string;
  status: CartStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  total: number;
}

export interface CartItem {
  id: string;
  cartId: string;
  productId: string | null;
  name: string;
  price: number;
  quantity: number;
  url: string;
  supplier: string;
  position: number;
  createdAt: string;
}

export interface CartFull extends CartSummary {
  items: CartItem[];
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string | null;
  name: string;
  price: number;
  quantity: number;
}

export interface OrderSummary {
  id: string;
  cartId: string | null;
  number: string;
  status: OrderStatus;
  total: number;
  placedBy: string;
  createdAt: string;
  updatedAt: string;
  cartName: string | null;
  placedByName: string | null;
}

export interface OrderFull extends OrderSummary {
  items: OrderItem[];
}

// ===== Asystent AI (Faza 6) =====
export interface AiProduct {
  name: string;
  price: number;
  url: string;
  supplier: string;
  reason?: string;
}

export interface AiReply {
  type: "products" | "text";
  answer: string;
  products?: AiProduct[];
}

export interface AiThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface AiChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "tool";
  content: AiReply | { text: string };
  createdAt: string;
}

/** Typ MIME używany w drag & drop kart produktów AI (kanban, koszyki). */
export const AI_PRODUCT_MIME = "application/x-klinika-product";

export type { User };

export type Status = "open" | "review" | "closed";
export type Category = "general" | "content" | "design" | "functionality";
export type SiteMode = "private" | "public";
export interface Site {
  id: string;
  name: string;
  origins: string[];
  embed_url: string;
  mode: SiteMode;
  role?: "owner" | "member" | "guest";
  feedback_version?: number;
  participant_id?: string;
}
export interface WidgetSession {
  id: string;
  name: string;
  token: string;
  expires_at: string;
  user_id?: number;
  role?: "owner" | "member" | "guest";
}
export interface Anchor {
  selector: string;
  text: string;
  x: number;
  y: number;
  documentX: number;
  documentY: number;
  viewportWidth: number;
}
export interface Comment {
  id: number;
  comment_number: number;
  page_id: number;
  participant_id: string;
  name: string;
  body: string;
  status: Status;
  category: Category;
  anchor: Anchor;
  version: number;
  created_at: string;
  unread?: boolean;
  latest_activity_id?: number;
}
export interface Reply {
  id: number;
  participant_id: string;
  name: string;
  body: string;
  kind: string;
  created_at: string;
}
export interface Attachment {
  id: number;
  participant_id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}
export interface Thread {
  reply_count: number;
  reply_before: number | null;
  latest_activity_id: number;
  comment: Comment;
  replies: Reply[];
  attachments: Attachment[];
}
export interface Page {
  id: number;
  title: string;
  url: string;
  counts: Partial<Record<Status, number>>;
}
export interface Activity {
  unread: boolean;
  id: number;
  comment_id: number;
  comment_number: number;
  name: string;
  type: string;
  summary: string;
  comment_body?: string;
  created_at: string;
  title: string;
  url: string;
}

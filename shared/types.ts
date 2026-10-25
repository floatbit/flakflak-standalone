export type Status = "open" | "review" | "content" | "closed";
export interface Site {
  id: string;
  name: string;
  origins: string[];
  embed_url: string;
}
export interface Guest {
  id: string;
  name: string;
  token: string;
  expires_at: string;
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
  page_id: number;
  participant_id: string;
  name: string;
  body: string;
  status: Status;
  anchor: Anchor;
  version: number;
  created_at: string;
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
  id: number;
  comment_id: number;
  name: string;
  type: string;
  summary: string;
  created_at: string;
  title: string;
  url: string;
}

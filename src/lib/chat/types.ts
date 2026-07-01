export type Attachment = {
  id?: string;
  message_id?: string;
  conversation_id?: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at?: string;
};

export type Conversation = {
  id: string;
  title: string;
  summary: string | null;
  updated_at: string;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  attachments?: Attachment[];
};

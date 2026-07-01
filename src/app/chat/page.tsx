import { redirect } from "next/navigation";
import { ChatShell } from "@/components/chat/chat-shell";
import { SetupWarning } from "@/components/setup-warning";
import { env, hasSupabaseEnv } from "@/lib/env";
import { getModelOptions } from "@/lib/ai/model-presets";
import { ensureUserAccess } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";
import { parseUserPreferences } from "@/lib/user-preferences";
import type { Conversation, Message } from "@/lib/chat/types";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  if (!hasSupabaseEnv()) return <SetupWarning />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  const access = await ensureUserAccess(supabase, user);
  if (!access.isApproved) redirect("/pending");

  await supabase.from("user_profiles").upsert({
    id: user.id,
    display_name: user.user_metadata?.name || user.email || "Usuário",
  });

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("preferences")
    .eq("id", user.id)
    .single();

  const userPreferences = parseUserPreferences(profile?.preferences);

  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, title, summary, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(30);

  const initialConversation = conversations?.[0] as Conversation | undefined;
  let initialMessages: Message[] = [];

  if (initialConversation) {
    const { data: messages } = await supabase
      .from("messages")
      .select("id, conversation_id, role, content, created_at, attachments:message_attachments(id, message_id, conversation_id, storage_path, file_name, mime_type, size_bytes, created_at)")
      .eq("conversation_id", initialConversation.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    initialMessages = (messages || []) as Message[];
  }

  return (
    <ChatShell
      initialConversations={(conversations || []) as Conversation[]}
      initialConversationId={initialConversation?.id}
      initialMessages={initialMessages}
      userEmail={user.email}
      modelName={userPreferences.preferredModel || env.aiModel}
      providerName={env.aiProvider}
      audioTranscriptionModel={env.audioTranscriptionModel}
      modelOptions={getModelOptions(env.aiProvider, env.aiModel)}
      initialPreferences={userPreferences}
    />
  );
}

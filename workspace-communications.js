export const REPORT_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
export const REPORT_ATTACHMENT_BUCKET = "report-attachments";

const ALLOWED_REPORT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

export async function fetchWorkspaceDirectory(supabase) {
  const { data, error } = await supabase.rpc("workspace_directory");
  if (error) throw error;
  return data || [];
}

export async function fetchConversations(supabase, userId) {
  const { data, error } = await supabase.from("chat_conversations")
    .select("id, participant_one, participant_two, updated_at")
    .or(`participant_one.eq.${userId},participant_two.eq.${userId}`)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const conversations = data || [];
  if (!conversations.length) return [];
  const { data: messages, error: messagesError } = await supabase.from("chat_messages")
    .select("conversation_id, sender_id, body, created_at")
    .in("conversation_id", conversations.map((conversation) => conversation.id))
    .order("created_at", { ascending: false });
  if (messagesError) throw messagesError;
  const latestByConversation = new Map();
  for (const message of messages || []) {
    if (!latestByConversation.has(message.conversation_id)) latestByConversation.set(message.conversation_id, message);
  }
  return conversations.map((conversation) => ({
    ...conversation,
    last_message: latestByConversation.get(conversation.id) || null
  }));
}

export async function openConversation(supabase, userId, partnerId) {
  if (!partnerId || userId === partnerId) throw new Error("Choose another workspace member to start a chat.");
  const [participantOne, participantTwo] = [userId, partnerId].sort();
  const { data, error } = await supabase.from("chat_conversations")
    .upsert({ participant_one: participantOne, participant_two: participantTwo }, {
      onConflict: "participant_one,participant_two",
      ignoreDuplicates: true
    })
    .select("id, participant_one, participant_two, updated_at")
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: existing, error: lookupError } = await supabase.from("chat_conversations")
    .select("id, participant_one, participant_two, updated_at")
    .eq("participant_one", participantOne)
    .eq("participant_two", participantTwo)
    .single();
  if (lookupError) throw lookupError;
  return existing;
}

export async function fetchConversationMessages(supabase, conversationId) {
  const { data, error } = await supabase.from("chat_messages")
    .select("id, conversation_id, sender_id, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function sendConversationMessage(supabase, conversationId, senderId, body) {
  const text = body.trim();
  if (!text || text.length > 2000) throw new Error("Messages must be between 1 and 2,000 characters.");
  const { data, error } = await supabase.from("chat_messages")
    .insert({ conversation_id: conversationId, sender_id: senderId, body: text })
    .select("id, conversation_id, sender_id, body, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function fetchEmployeeReports(supabase) {
  const { data, error } = await supabase.from("employee_reports")
    .select("id, employee_id, task_title, body, attachment_path, attachment_name, attachment_type, attachment_size, status, review_note, reviewed_at, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function submitEmployeeReport(supabase, { employeeId, taskTitle, body, file }) {
  const text = body.trim();
  if (!text || text.length > 5000) throw new Error("A report must be between 1 and 5,000 characters.");

  let attachment = {};
  let attachmentPath;
  if (file) {
    if (file.size < 1 || file.size > REPORT_ATTACHMENT_MAX_BYTES) {
      throw new Error("Choose a file no larger than 3 MB.");
    }
    if (!ALLOWED_REPORT_TYPES.has(file.type)) {
      throw new Error("Attach a PDF, image, text/CSV, Word, or Excel file.");
    }
    const extension = file.name.includes(".") ? file.name.split(".").pop().replace(/[^a-zA-Z0-9]/g, "").toLowerCase() : "";
    attachmentPath = `${employeeId}/${crypto.randomUUID()}${extension ? `.${extension}` : ""}`;
    const { error: uploadError } = await supabase.storage.from(REPORT_ATTACHMENT_BUCKET)
      .upload(attachmentPath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    attachment = {
      attachment_path: attachmentPath,
      attachment_name: file.name,
      attachment_type: file.type,
      attachment_size: file.size
    };
  }

  const { data, error } = await supabase.from("employee_reports")
    .insert({
      employee_id: employeeId,
      task_title: taskTitle || "",
      body: text,
      ...attachment
    })
    .select("id, employee_id, task_title, body, attachment_path, attachment_name, attachment_type, attachment_size, status, review_note, reviewed_at, created_at")
    .single();
  if (error) {
    if (attachmentPath) {
      const { error: cleanupError } = await supabase.storage.from(REPORT_ATTACHMENT_BUCKET).remove([attachmentPath]);
      if (cleanupError) throw new Error(`${error.message} (Attachment cleanup failed: ${cleanupError.message})`);
    }
    throw error;
  }
  return data;
}

export async function reviewEmployeeReport(supabase, reportId, status, reviewNote) {
  if (!["approved", "rejected"].includes(status)) throw new Error("Choose approved or rejected.");
  const { data, error } = await supabase.from("employee_reports")
    .update({
      status,
      review_note: reviewNote.trim() || null,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", reportId)
    .select("id, employee_id, task_title, body, attachment_path, attachment_name, attachment_type, attachment_size, status, review_note, reviewed_at, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function createReportAttachmentLink(supabase, path) {
  const { data, error } = await supabase.storage.from(REPORT_ATTACHMENT_BUCKET).createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}

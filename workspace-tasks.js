export async function fetchWorkspaceTasks(supabase) {
  const { data, error } = await supabase
    .from("workspace_tasks")
    .select("id, title, project, assignee_id, priority, due, status, skill, completion_percentage")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export function workspaceTaskFromRow(row, team) {
  return {
    id: Number(row.id),
    title: row.title,
    project: row.project || "",
    assignee: team.find((member) => member.id === row.assignee_id)?.name || "",
    priority: row.priority,
    due: row.due || "",
    status: row.status,
    skill: row.skill || "",
    completionPercentage: row.completion_percentage ?? (row.status === "Completed" ? 100 : 0)
  };
}

function rowFromWorkspaceTask(task, team) {
  const member = team.find((candidate) => candidate.name === task.assignee);
  if (task.assignee && !member) {
    throw new Error(`The assigned employee "${task.assignee}" is not in the workspace directory.`);
  }
  return {
    title: task.title,
    project: task.project || "",
    assignee_id: member?.id || null,
    priority: task.priority,
    due: task.due || null,
    status: task.status,
    skill: task.skill || "",
    completion_percentage: task.completionPercentage ?? (task.status === "Completed" ? 100 : 0)
  };
}

export async function insertWorkspaceTask(supabase, task, team) {
  const { data, error } = await supabase
    .from("workspace_tasks")
    .insert(rowFromWorkspaceTask(task, team))
    .select("id, title, project, assignee_id, priority, due, status, skill, completion_percentage")
    .single();
  if (error) throw error;
  return data;
}

export async function updateWorkspaceTask(supabase, task, team) {
  const { data, error } = await supabase
    .from("workspace_tasks")
    .update(rowFromWorkspaceTask(task, team))
    .eq("id", task.id)
    .select("id, title, project, assignee_id, priority, due, status, skill, completion_percentage")
    .single();
  if (error) throw error;
  return data;
}

export async function importLegacyWorkspaceTasks(supabase, tasks, team) {
  if (!tasks.length) return [];
  const { data, error } = await supabase
    .from("workspace_tasks")
    .insert(tasks.map((task) => rowFromWorkspaceTask(task, team)))
    .select("id, title, project, assignee_id, priority, due, status, skill, completion_percentage");
  if (error) throw error;
  return data || [];
}

export async function updateWorkspaceTaskStatus(supabase, taskId, status) {
  const { error } = await supabase.rpc("update_workspace_task_status", {
    task_id: taskId,
    new_status: status
  });
  if (error) throw error;
}

export async function deleteWorkspaceTasks(supabase, taskIds) {
  if (!taskIds.length) return [];
  const { data, error } = await supabase
    .from("workspace_tasks")
    .delete()
    .in("id", taskIds)
    .select("id");
  if (error) throw error;
  const deletedIds = (data || []).map((row) => Number(row.id));
  if (deletedIds.length !== taskIds.length) {
    throw new Error("Not all selected tasks were deleted. Refresh the task list and try again.");
  }
  return deletedIds;
}

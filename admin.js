import { supabase, supabaseConfigured } from "./supabase-client.js";
import {
  createReportAttachmentLink,
  fetchConversations,
  fetchConversationMessages,
  fetchEmployeeReports,
  fetchWorkspaceDirectory,
  openConversation,
  reviewEmployeeReport,
  sendConversationMessage
} from "./workspace-communications.js";
import { skillMatchScore } from "./skill-matching.js";
import {
  fetchWorkspaceTasks,
  importLegacyWorkspaceTasks,
  insertWorkspaceTask,
  updateWorkspaceTask,
  workspaceTaskFromRow
} from "./workspace-tasks.js";

(async () => {
  if (!supabaseConfigured) {
    window.location.replace("login.html");
    return;
  }
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) {
    window.location.replace("login.html");
    return;
  }
  const { data: adminProfile, error: adminProfileError } = await supabase.from("profiles")
    .select("full_name, role")
    .eq("id", session.user.id)
    .maybeSingle();
  if (adminProfileError || !adminProfile || adminProfile.role !== "admin") {
    if (adminProfile?.role === "employee") window.location.replace("index.html");
    else {
      await supabase.auth.signOut();
      window.location.replace("login.html");
    }
    return;
  }
  const adminSession = { id: session.user.id, name: adminProfile.full_name, role: adminProfile.role, email: session.user.email };
  let team = [];
  let employeeProfilesLoaded = false;
  async function refreshEmployeeProfiles() {
    const { data: employeeProfiles, error: employeeProfilesError } = await supabase.from("profiles")
      .select("id, email, full_name, role, skills")
      .eq("role", "employee")
      .order("full_name");
    if (employeeProfilesError) throw employeeProfilesError;
    const colors = ["avatar-maya", "avatar-alex", "avatar-sam", "avatar-taylor", "avatar-jordan"];
    const imported = (employeeProfiles || []).map((profile, index) => ({
      id: profile.id,
      email: profile.email,
      name: profile.full_name,
      initials: profile.full_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
      color: colors[index % colors.length],
      skills: Array.isArray(profile.skills) ? profile.skills : []
    }));
    team = imported;
    employeeProfilesLoaded = true;
  }
  try {
    await refreshEmployeeProfiles();
  } catch (error) {
    document.querySelector("#importStatus").textContent = `Couldn't load employee accounts: ${error.message}`;
  }
  function dateFromNow(days) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  const initialTasks = [
    { id: 1, title: "Redesign onboarding flow", project: "Website redesign", assignee: "", priority: "High", due: dateFromNow(3), status: "In progress", skill: "Product design" },
    { id: 2, title: "API integration for dashboard", project: "Analytics platform", assignee: "", priority: "High", due: dateFromNow(4), status: "In progress", skill: "Backend development" },
    { id: 3, title: "Write product launch copy", project: "Spring launch", assignee: "", priority: "Medium", due: dateFromNow(6), status: "To do", skill: "Content writing" },
    { id: 4, title: "Set up component library", project: "Website redesign", assignee: "", priority: "Medium", due: dateFromNow(7), status: "In review", skill: "Frontend development" },
    { id: 5, title: "Analyze customer feedback", project: "Research sprint", assignee: "", priority: "Low", due: dateFromNow(9), status: "To do", skill: "Data analysis" },
    { id: 6, title: "Map user journey", project: "Website redesign", assignee: "", priority: "Medium", due: dateFromNow(10), status: "Completed", skill: "Research" },
    { id: 7, title: "Prepare project kickoff", project: "Spring launch", assignee: "", priority: "High", due: dateFromNow(2), status: "To do", skill: "Project management" },
    { id: 8, title: "Review accessibility audit", project: "Website redesign", assignee: "", priority: "Medium", due: dateFromNow(5), status: "To do", skill: "Product design" },
    { id: 9, title: "Build reporting prototype", project: "Analytics platform", assignee: "", priority: "Medium", due: dateFromNow(8), status: "To do", skill: "Data analysis" }
  ];
  let saved;
  try { saved = JSON.parse(localStorage.getItem("orbit-workspace") || "{}"); }
  catch { saved = {}; }
  let tasks = Array.isArray(saved.tasks) ? saved.tasks : initialTasks;
  let assignmentsNeedCleanup = false;
  if (employeeProfilesLoaded) {
    const employeeNames = new Set(team.map((member) => member.name));
    tasks.forEach((task) => {
      if (task.assignee && !employeeNames.has(task.assignee)) {
        task.assignee = "";
        assignmentsNeedCleanup = true;
      }
    });
  }
  let activities = Array.isArray(saved.activities) ? saved.activities : [];
  let activeView = "tasks";
  let workspaceDirectory = [];
  let conversations = [];
  let selectedConversationId = null;
  let reports = [];
  let toastTimer;
  let suggestions = [];
  let importing = false;
  const expandedProjects = new Set();
  const $ = (selector) => document.querySelector(selector);
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  function persist() {
    try {
      const nextSaved = { ...saved, team, tasks, activities };
      delete nextSaved.messages;
      delete nextSaved.reports;
      localStorage.setItem("orbit-workspace", JSON.stringify(nextSaved));
      saved = nextSaved;
      return true;
    } catch {
      showToast("Couldn't save changes in this browser. Check available storage.");
      return false;
    }
  }
  function showToast(message) {
    const toast = $("#adminToast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }
  if (assignmentsNeedCleanup) persist();
  function shortDate(value) {
    if (!value) return "No date";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  function render() {
    const search = $("#adminSearch").value.trim().toLowerCase();
    const status = $("#adminStatusFilter").value;
    const visible = tasks.filter((task) => {
      const searchMatch = !search || `${task.title} ${task.project} ${task.skill} ${task.assignee}`.toLowerCase().includes(search);
      return searchMatch && (status === "all" || task.status === status);
    });
    const projects = new Map();
    visible.forEach((task) => {
      const project = task.project || "Uncategorized";
      if (!projects.has(project)) projects.set(project, []);
      projects.get(project).push(task);
    });
    const projectCards = [...projects].map(([project, projectTasks], index) => {
      const projectId = `project-${index}`;
      const isExpanded = expandedProjects.has(project);
      const taskRows = projectTasks.map((task) => {
        const options = `<option value="">Unassigned</option>${team.map((member) => `<option value="${escapeHTML(member.name)}" ${task.assignee === member.name ? "selected" : ""}>${escapeHTML(member.name)}</option>`).join("")}`;
        return `<tr><td><div class="task-name">${escapeHTML(task.title)}</div></td>
          <td>${escapeHTML(task.skill)}</td><td><span class="priority priority-${escapeHTML(task.priority.toLowerCase())}">${escapeHTML(task.priority)}</span></td>
          <td><span class="due-cell">${escapeHTML(shortDate(task.due))}</span></td>
          <td><span class="status-pill status-${escapeHTML(task.status.toLowerCase().replaceAll(" ", "-"))}">${escapeHTML(task.status)}</span></td>
          <td><select class="assignee-select" data-assignment="${escapeHTML(task.id)}" aria-label="Assign ${escapeHTML(task.title)}">${options}</select></td></tr>`;
      }).join("");
      return `<article class="admin-project-card${isExpanded ? " expanded" : ""}">
        <button type="button" class="admin-project-toggle" data-project-toggle="${escapeHTML(project)}" aria-expanded="${isExpanded}" aria-controls="${projectId}-details">
          <span class="admin-project-icon" aria-hidden="true">▦</span>
          <span class="admin-project-title">${escapeHTML(project)}</span>
          <span class="admin-project-count">${projectTasks.length} ${projectTasks.length === 1 ? "task" : "tasks"}</span>
          <span class="admin-project-chevron" aria-hidden="true">${isExpanded ? "⌃" : "⌄"}</span>
        </button>
        <div class="admin-project-details${isExpanded ? "" : " hidden"}" id="${projectId}-details">
          <div class="task-table-wrap"><table class="task-table admin-task-table"><thead><tr><th>TASK</th><th>SKILL</th><th>PRIORITY</th><th>DUE DATE</th><th>STATUS</th><th>ASSIGN TO</th></tr></thead><tbody>${taskRows}</tbody></table></div>
        </div>
      </article>`;
    }).join("");
    $("#adminTaskRows").innerHTML = projectCards;
    $("#adminEmpty").classList.toggle("hidden", visible.length > 0);
    $("#adminTaskSummary").textContent = `${projects.size} ${projects.size === 1 ? "project" : "projects"} · ${visible.length} ${visible.length === 1 ? "task" : "tasks"}`;
    $("#activeCount").textContent = tasks.filter((task) => task.status !== "Completed").length;
    $("#unassignedCount").textContent = tasks.filter((task) => !task.assignee && task.status !== "Completed").length;
    $("#completedCount").textContent = tasks.filter((task) => task.status === "Completed").length;
    $("#teamCount").textContent = team.length;
    const assignment = $("#adminTaskAssignee");
    const previous = assignment.value;
    assignment.innerHTML = `<option value="">Leave unassigned</option>${team.map((member) => `<option value="${escapeHTML(member.name)}">${escapeHTML(member.name)} · ${escapeHTML(member.skills.join(", "))}</option>`).join("")}`;
    if (team.some((member) => member.name === previous)) assignment.value = previous;
  }
  function directoryName(id) {
    return workspaceDirectory.find((person) => person.id === id)?.full_name || "Workspace member";
  }
  function chatPartner(conversation) {
    const id = conversation.participant_one === adminSession.id ? conversation.participant_two : conversation.participant_one;
    return workspaceDirectory.find((person) => person.id === id);
  }
  function renderChatDirectory() {
    const options = workspaceDirectory.filter((person) => person.id !== adminSession.id)
      .map((person) => `<option value="${escapeHTML(person.id)}">${escapeHTML(person.full_name)} · ${escapeHTML(person.role)}</option>`)
      .join("");
    $("#adminChatPartner").innerHTML = options || '<option value="">No other workspace members</option>';
    if (!selectedConversationId && conversations.length) selectedConversationId = conversations[0].id;
    const search = $("#adminSearch").value.trim().toLowerCase();
    const visible = conversations.filter((conversation) => {
      const person = chatPartner(conversation);
      const lastMessage = conversation.last_message?.body || "";
      return !search || `${person?.full_name || ""} ${lastMessage}`.toLowerCase().includes(search);
    });
    $("#adminConversationList").innerHTML = visible.map((conversation) => {
      const person = chatPartner(conversation);
      const lastMessage = conversation.last_message;
      return `<button type="button" class="chat-conversation${selectedConversationId === conversation.id ? " active" : ""}" data-admin-conversation="${escapeHTML(conversation.id)}">
        <span class="chat-person-avatar">${escapeHTML((person?.full_name || "W").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase())}</span>
        <span class="chat-conversation-copy"><strong>${escapeHTML(person?.full_name || "Workspace member")}</strong><small>${escapeHTML(lastMessage?.body || "Start the conversation")}</small></span>
        <time>${lastMessage ? new Date(lastMessage.created_at).toLocaleDateString() : ""}</time>
      </button>`;
    }).join("");
    if (!visible.length) $("#adminConversationList").innerHTML = '<div class="admin-message-empty">No conversations yet.</div>';
  }
  async function renderChatThread() {
    const conversation = conversations.find((item) => item.id === selectedConversationId);
    const partner = conversation && chatPartner(conversation);
    $("#adminChatTitle").textContent = partner?.full_name || "Select a conversation";
    $("#adminChatStatus").textContent = partner?.role || "";
    $("#adminChatInput").disabled = !conversation;
    $("#adminChatForm button").disabled = !conversation;
    if (!conversation) {
      $("#adminChatMessages").innerHTML = '<div class="admin-message-empty">Choose a workspace member to open a chat.</div>';
      return;
    }
    try {
      const thread = await fetchConversationMessages(supabase, conversation.id);
      $("#adminChatMessages").innerHTML = thread.map((message) => {
        const own = message.sender_id === adminSession.id;
        return `<article class="chat-bubble-row ${own ? "own" : ""}"><div class="chat-bubble"><strong>${escapeHTML(own ? "You" : directoryName(message.sender_id))}</strong><p>${escapeHTML(message.body)}</p><time>${escapeHTML(new Date(message.created_at).toLocaleString())}</time></div></article>`;
      }).join("") || '<div class="admin-message-empty">No messages yet. Say hello.</div>';
      $("#adminChatMessages").scrollTop = $("#adminChatMessages").scrollHeight;
    } catch (error) {
      showToast(`Couldn't load conversation: ${error.message}`);
    }
  }
  async function refreshChats() {
    conversations = await fetchConversations(supabase, adminSession.id);
    if (selectedConversationId && !conversations.some((conversation) => conversation.id === selectedConversationId)) selectedConversationId = null;
    renderChatDirectory();
    await renderChatThread();
  }
  async function renderAdminReports() {
    const filter = $("#adminReportFilter").value;
    const search = $("#adminSearch").value.trim().toLowerCase();
    const visible = reports.filter((report) => {
      const employee = team.find((member) => member.id === report.employee_id);
      const searchMatch = !search || `${employee?.name || directoryName(report.employee_id)} ${report.task_title} ${report.body} ${report.status} ${report.review_note || ""}`.toLowerCase().includes(search);
      return searchMatch && (filter === "all" || report.status === filter);
    });
    const pendingCount = reports.filter((report) => report.status === "pending").length;
    $("#pendingReportCount").textContent = pendingCount;
    $("#pendingReportCount").classList.toggle("hidden", pendingCount === 0);
    $("#adminReportsEmpty").classList.toggle("hidden", visible.length > 0);
    const cards = await Promise.all(visible.map(async (report) => {
      let attachmentMarkup = '<span class="report-no-attachment">No attachment</span>';
      if (report.attachment_path) {
        try {
          const href = await createReportAttachmentLink(supabase, report.attachment_path);
          attachmentMarkup = `<a class="report-attachment-link" href="${escapeHTML(href)}" target="_blank" rel="noopener">${escapeHTML(report.attachment_name || "View attachment")} · ${(report.attachment_size / (1024 * 1024)).toFixed(2)} MB ↗</a>`;
        } catch (error) {
          attachmentMarkup = `<span class="report-attachment-error">Attachment unavailable: ${escapeHTML(error.message)}</span>`;
        }
      }
      const employee = team.find((member) => member.id === report.employee_id);
      return `<article class="admin-report-card">
        <header class="admin-report-card-heading"><div><strong>${escapeHTML(employee?.name || directoryName(report.employee_id))}</strong><span>${escapeHTML(report.task_title || "General update")} · ${escapeHTML(new Date(report.created_at).toLocaleString())}</span></div><span class="report-status report-status-${escapeHTML(report.status)}">${escapeHTML(report.status)}</span></header>
        <p class="admin-report-body">${escapeHTML(report.body)}</p><div class="admin-report-attachment">${attachmentMarkup}</div>
        ${report.status === "pending" ? `<form class="admin-review-form" data-report-review="${escapeHTML(report.id)}"><textarea maxlength="1000" placeholder="Optional review note"></textarea><div><button type="submit" class="button button-primary" data-review-status="approved">Approve</button><button type="submit" class="button button-outline" data-review-status="rejected">Request changes</button></div></form>` : `<p class="admin-review-note">${report.review_note ? `Review note: ${escapeHTML(report.review_note)}` : "No review note."}${report.reviewed_at ? ` · Reviewed ${escapeHTML(new Date(report.reviewed_at).toLocaleString())}` : ""}</p>`}
      </article>`;
    }));
    $("#adminReportList").innerHTML = cards.join("");
  }
  function setAdminView(view) {
    activeView = view;
    const isMessages = view === "messages";
    const isReports = view === "reports";
    $("#taskManagementView").classList.toggle("hidden", isMessages || isReports);
    $("#messagesView").classList.toggle("hidden", !isMessages);
    $("#reportsView").classList.toggle("hidden", !isReports);
    $("#adminBreadcrumb").textContent = isMessages ? "Chats" : isReports ? "Report reviews" : "Task management";
    $("#adminSearch").value = "";
    $("#adminSearch").placeholder = isMessages ? "Search conversations..." : isReports ? "Search reports..." : "Search tasks...";
    document.querySelectorAll("[data-admin-view]").forEach((link) => {
      link.classList.toggle("active", link.dataset.adminView === view);
      if (link.dataset.adminView === view) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (isMessages) refreshChats().catch((error) => showToast(`Couldn't load chats: ${error.message}`));
    else if (isReports) fetchEmployeeReports(supabase).then((loadedReports) => {
      reports = loadedReports;
      return renderAdminReports();
    }).catch((error) => showToast(`Couldn't load reports: ${error.message}`));
    else render();
  }
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') quoted = false;
        else field += character;
      } else if (character === '"' && field.length === 0) quoted = true;
      else if (character === ",") {
        row.push(field.trim());
        field = "";
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        row.push(field.trim());
        if (row.some((cell) => cell.length)) rows.push(row);
        row = [];
        field = "";
      } else field += character;
    }
    if (quoted) throw new Error("CSV contains an unclosed quoted field.");
    row.push(field.trim());
    if (row.some((cell) => cell.length)) rows.push(row);
    if (rows.length < 2) throw new Error("CSV needs a header row and at least one employee.");
    const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, "").trim().toLowerCase().replaceAll(" ", "_"));
    for (const required of ["email", "password"]) {
      if (!headers.includes(required)) throw new Error(`CSV is missing the required "${required}" column.`);
    }
    return rows.map((cells, index) => {
      const record = Object.fromEntries(headers.map((header, column) => [header, cells[column] || ""]));
      return {
        row: index + 2,
        email: record.email.trim().toLowerCase(),
        password: record.password,
        full_name: (record.full_name || record.name || "").trim(),
        skills: (record.skills || "").split(/[;|]/).map((skill) => skill.trim()).filter(Boolean)
      };
    });
  }
  function downloadCsvTemplate() {
    const csv = "email,password,full_name,skills\r\nemployee@company.com,ChangeMe-Temp-2026,Employee Name,\"Product design; Research\"\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "team-flow-employee-import-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function openMatches() {
    if (!employeeProfilesLoaded) {
      showToast("Employee skills couldn't be loaded. Refresh the employee list and try again.");
      return;
    }
    if (!team.length) {
      showToast("Add employee profiles and skills before requesting suggestions.");
      return;
    }
    const unassigned = tasks.filter((task) => !task.assignee && task.status !== "Completed");
    if (!unassigned.length) {
      showToast("All open tasks have an owner. Create a task to get another suggestion.");
      return;
    }
    const projected = new Map();
    suggestions = unassigned.map((task) => {
      const ranked = team.map((member) => ({
        member,
        skillMatch: skillMatchScore(task.skill, member.skills),
        openTasks: tasks.filter((item) => item.assignee === member.name && item.status !== "Completed").length,
        projectedTasks: projected.get(member.id) || 0
      })).sort((left, right) =>
        right.skillMatch - left.skillMatch
        || (left.openTasks + left.projectedTasks) - (right.openTasks + right.projectedTasks)
        || left.member.name.localeCompare(right.member.name)
      );
      const bestMatch = ranked.find((candidate) => candidate.skillMatch > 0);
      if (bestMatch) projected.set(bestMatch.member.id, (projected.get(bestMatch.member.id) || 0) + 1);
      return { task, ranked, recommendedMemberId: bestMatch?.member.id || "" };
    });
    $("#adminSuggestionList").innerHTML = suggestions.map((suggestion, index) => {
      const hasSkillMatch = Boolean(suggestion.recommendedMemberId);
      const candidates = suggestion.ranked.map(({ member, skillMatch, openTasks, projectedTasks }) =>
        `<option value="${escapeHTML(member.id)}" ${suggestion.recommendedMemberId === member.id ? "selected" : ""}>${escapeHTML(member.name)} — ${skillMatch}% skill match · ${openTasks + projectedTasks} active ${openTasks + projectedTasks === 1 ? "task" : "tasks"}</option>`
      ).join("");
      const skills = suggestion.ranked.map(({ member }) => member.skills.length ? `${escapeHTML(member.name)}: ${escapeHTML(member.skills.join(", "))}` : `${escapeHTML(member.name)}: no skills listed`).join(" · ");
      return `<div class="suggestion-task">
        <label class="suggestion-card">
          <input type="checkbox" value="${index}" ${hasSkillMatch ? "checked" : ""} />
          <span><strong>${escapeHTML(suggestion.task.title)}</strong><p>Required skill: ${escapeHTML(suggestion.task.skill || "not set")} · ${escapeHTML(suggestion.task.priority)} priority</p>
            <span>${hasSkillMatch ? `✦ Recommended: ${escapeHTML(suggestion.ranked.find((candidate) => candidate.member.id === suggestion.recommendedMemberId).member.name)} · ${suggestion.ranked.find((candidate) => candidate.member.id === suggestion.recommendedMemberId).skillMatch}% skill match` : "No employee skill matches this task. Choose a person manually or update their profile skills."}</span>
          </span>
        </label>
        <label class="suggestion-owner-label" for="suggestionOwner${index}">Assign to</label>
        <select id="suggestionOwner${index}" data-suggestion-owner="${index}">
          <option value="">${hasSkillMatch ? "Select an employee" : "No skill match — choose manually"}</option>${candidates}
        </select>
        <small class="suggestion-skill-list">${skills}</small>
      </div>`;
    }).join("");
    $("#adminMatchModal").showModal();
  }

  $("#adminName").textContent = adminSession.name;
  $("#adminInitials").textContent = adminSession.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  $("#adminTopAvatar").textContent = adminSession.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  document.querySelectorAll("[data-account-name]").forEach((element) => { element.textContent = adminSession.name; });
  document.querySelectorAll("[data-account-email]").forEach((element) => { element.textContent = adminSession.email || "Unavailable"; });
  $("#adminDate").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase();
  $("#adminSearch").addEventListener("input", () => {
    if (activeView === "messages") renderChatDirectory();
    else if (activeView === "reports") renderAdminReports().catch((error) => showToast(`Couldn't search reports: ${error.message}`));
    else render();
  });
  $("#adminReportFilter").addEventListener("change", () => renderAdminReports().catch((error) => showToast(`Couldn't filter reports: ${error.message}`)));
  $("#adminStartChat").addEventListener("click", async () => {
    try {
      const partnerId = $("#adminChatPartner").value;
      const conversation = await openConversation(supabase, adminSession.id, partnerId);
      selectedConversationId = conversation.id;
      await refreshChats();
    } catch (error) {
      showToast(`Couldn't open chat: ${error.message}`);
    }
  });
  $("#adminConversationList").addEventListener("click", async (event) => {
    const item = event.target.closest("[data-admin-conversation]");
    if (!item) return;
    selectedConversationId = item.dataset.adminConversation;
    renderChatDirectory();
    await renderChatThread();
  });
  $("#adminChatForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#adminChatInput");
    const body = input.value.trim();
    if (!selectedConversationId || !body) return;
    input.disabled = true;
    $("#adminChatForm button").disabled = true;
    try {
      await sendConversationMessage(supabase, selectedConversationId, adminSession.id, body);
      input.value = "";
      await refreshChats();
    } catch (error) {
      showToast(`Couldn't send message: ${error.message}`);
    } finally {
      input.disabled = !selectedConversationId;
      $("#adminChatForm button").disabled = !selectedConversationId;
    }
  });
  $("#adminReportList").addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-report-review]");
    if (!form) return;
    event.preventDefault();
    const status = event.submitter?.dataset.reviewStatus;
    if (!status) return;
    const buttons = [...form.querySelectorAll("button")];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await reviewEmployeeReport(supabase, form.dataset.reportReview, status, form.querySelector("textarea").value);
      reports = await fetchEmployeeReports(supabase);
      await renderAdminReports();
      showToast(status === "approved" ? "Report approved." : "Changes requested.");
    } catch (error) {
      buttons.forEach((button) => { button.disabled = false; });
      showToast(`Couldn't review report: ${error.message}`);
    }
  });
  $("#adminStatusFilter").addEventListener("change", render);
  $("#adminTaskRows").addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-project-toggle]");
    if (!toggle) return;
    const project = toggle.dataset.projectToggle;
    if (expandedProjects.has(project)) expandedProjects.delete(project);
    else expandedProjects.add(project);
    render();
  });
  $("#smartAssignButton").addEventListener("click", openMatches);
  $("#smartAssignFooter").addEventListener("click", openMatches);
  $("#downloadCsvTemplate").addEventListener("click", downloadCsvTemplate);
  $("#employeeCsv").addEventListener("change", async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    const status = $("#importStatus");
    if (!file) return;
    if (importing) return;
    importing = true;
    status.textContent = "Reading and validating employee CSV…";
    try {
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Choose a CSV file.");
      if (file.size > 1024 * 1024) throw new Error("CSV file must be 1 MB or smaller.");
      const csvText = await file.text();
      let employees = parseCsv(csvText);
      if (employees.length > 100) throw new Error("Import up to 100 employees at a time.");
      const seenEmails = new Set();
      for (const employee of employees) {
        if (!employee.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email)) throw new Error(`Row ${employee.row}: enter a valid email address.`);
        if (!employee.full_name) throw new Error(`Row ${employee.row}: enter a full_name.`);
        if (employee.password.length < 12) throw new Error(`Row ${employee.row}: passwords must be at least 12 characters.`);
        if (seenEmails.has(employee.email)) throw new Error(`Row ${employee.row}: duplicate email ${employee.email}.`);
        seenEmails.add(employee.email);
      }
      if (employees.length === 0) throw new Error("CSV has no employee rows to import.");
      status.textContent = `Importing ${employees.length} employee ${employees.length === 1 ? "account" : "accounts"} securely…`;
      const { data, error } = await supabase.functions.invoke("import-employees", { body: { employees } });
      if (error) {
        let detail = error.message;
        if (error.context instanceof Response) {
          const response = error.context;
          const responseText = await response.clone().text();
          if (responseText) {
            try {
              const body = JSON.parse(responseText);
              detail = body.error || body.message || responseText;
            } catch {
              detail = responseText;
            }
          }
          detail = `HTTP ${response.status}: ${detail}`;
        }
        throw new Error(detail);
      }
      const results = Array.isArray(data?.results) ? data.results : [];
      const succeeded = results.filter((result) => result.success).length;
      const failed = results.length - succeeded;
      $("#importResultsList").innerHTML = results.map((result) =>
        `<div class="import-result ${result.success ? "success" : "failure"}"><span>${result.success ? "✓" : "!"}</span><strong>${escapeHTML(result.email)}</strong><small>${escapeHTML(result.message)}</small></div>`
      ).join("");
      $("#importResults").classList.remove("hidden");
      status.textContent = `${succeeded} account${succeeded === 1 ? "" : "s"} created${failed ? `; ${failed} failed` : ""}.`;
      await refreshEmployeeProfiles();
      workspaceDirectory = await fetchWorkspaceDirectory(supabase);
      render();
      renderChatDirectory();
    } catch (error) {
      status.textContent = `Import failed: ${error.message}`;
    } finally {
      input.value = "";
      importing = false;
    }
  });
  $("#newTaskButton").addEventListener("click", () => $("#adminTaskModal").showModal());
  document.querySelectorAll("[data-account-menu-toggle]").forEach((toggle) => toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = toggle.closest(".account-control").querySelector("[data-account-menu]");
    const willOpen = menu.hidden;
    document.querySelectorAll("[data-account-menu]").forEach((item) => { item.hidden = true; });
    document.querySelectorAll("[data-account-menu-toggle]").forEach((item) => item.setAttribute("aria-expanded", "false"));
    menu.hidden = !willOpen;
    toggle.setAttribute("aria-expanded", String(willOpen));
  }));
  document.querySelectorAll("[data-account-logout]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    const { error } = await supabase.auth.signOut();
    if (error) {
      button.disabled = false;
      showToast(`Couldn't sign out: ${error.message}`);
    } else {
      window.location.replace("login.html");
    }
  }));
  document.addEventListener("click", (event) => {
    if (event.target.closest(".account-control")) return;
    document.querySelectorAll("[data-account-menu]").forEach((menu) => { menu.hidden = true; });
    document.querySelectorAll("[data-account-menu-toggle]").forEach((toggle) => toggle.setAttribute("aria-expanded", "false"));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll("[data-account-menu]").forEach((menu) => { menu.hidden = true; });
    document.querySelectorAll("[data-account-menu-toggle]").forEach((toggle) => toggle.setAttribute("aria-expanded", "false"));
  });
  document.querySelectorAll("[data-admin-view]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    setAdminView(link.dataset.adminView);
  }));
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));
  $("#adminTaskRows").addEventListener("change", async (event) => {
    const select = event.target.closest("[data-assignment]");
    if (!select) return;
    const task = tasks.find((item) => String(item.id) === select.dataset.assignment);
    if (!task || task.assignee === select.value) return;
    const previousAssignee = task.assignee;
    task.assignee = select.value;
    const assignedMember = team.find((member) => member.name === task.assignee);
    activities.unshift({ name: assignedMember?.name || adminSession.name, initials: assignedMember?.initials || adminSession.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2), color: assignedMember?.color || "avatar-me", text: task.assignee ? `was assigned <strong>${escapeHTML(task.title)}</strong> by ${escapeHTML(adminSession.name)}` : `was unassigned from <strong>${escapeHTML(task.title)}</strong> by ${escapeHTML(adminSession.name)}`, time: "just now" });
    select.disabled = true;
    try {
      await updateWorkspaceTask(supabase, task, team);
      persist();
      render();
      showToast(task.assignee ? `${task.title} assigned to ${task.assignee}.` : `${task.title} is unassigned.`);
    } catch (error) {
      task.assignee = previousAssignee;
      activities.shift();
      render();
      showToast(`Couldn't save this assignment: ${error.message}`);
    }
  });
  $("#adminTaskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#adminTaskTitle").value.trim();
    if (!title) return;
    const due = $("#adminTaskDue").value;
    const assignee = $("#adminTaskAssignee").value;
    const task = {
      title, project: $("#adminTaskProject").value.trim(), skill: $("#adminTaskSkill").value,
      assignee, priority: $("#adminTaskPriority").value, due: due || "", status: "To do"
    };
    const assignedMember = team.find((member) => member.name === assignee);
    activities.unshift({ name: assignedMember?.name || adminSession.name, initials: assignedMember?.initials || adminSession.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2), color: assignedMember?.color || "avatar-me", text: assignee ? `was assigned <strong>${escapeHTML(title)}</strong> by ${escapeHTML(adminSession.name)}` : `created <strong>${escapeHTML(title)}</strong>`, time: "just now" });
    const submitButton = $("#adminTaskForm button[type='submit']");
    submitButton.disabled = true;
    try {
      const row = await insertWorkspaceTask(supabase, task, team);
      tasks.unshift(workspaceTaskFromRow(row, team));
      persist();
    } catch (error) {
      activities.shift();
      showToast(`Couldn't create the task: ${error.message}`);
      return;
    } finally {
      submitButton.disabled = false;
    }
    render();
    $("#adminTaskForm").reset();
    $("#adminTaskProject").value = "Studio North";
    $("#adminTaskModal").close();
    showToast(assignee ? "Task created and assigned." : "Task created. It is ready to assign.");
  });
  $("#applyAdminMatches").addEventListener("click", async () => {
    const selected = [...$("#adminSuggestionList").querySelectorAll("input[type='checkbox']:checked")]
      .map((input) => {
        const index = Number(input.value);
        const memberId = $("#adminSuggestionList").querySelector(`[data-suggestion-owner="${index}"]`)?.value;
        const suggestion = suggestions[index];
        const member = team.find((candidate) => candidate.id === memberId);
        return suggestion && member ? { suggestion, member } : null;
      })
      .filter(Boolean);
    if (!selected.length) {
      showToast("Select a suggestion with an employee chosen, or select a matching employee.");
      return;
    }
    const changed = [];
    selected.forEach(({ suggestion, member }) => {
      if (suggestion.task.assignee) return;
      suggestion.task.assignee = member.name;
      changed.push({ task: suggestion.task, member });
      const skillMatch = skillMatchScore(suggestion.task.skill, member.skills);
      activities.unshift({ name: member.name, initials: member.initials, color: member.color, text: `was assigned <strong>${escapeHTML(suggestion.task.title)}</strong> by ${escapeHTML(adminSession.name)}${skillMatch ? ` · ${skillMatch}% skill match` : " · manual selection (no skill match)"}`, time: "just now" });
    });
    if (!changed.length) {
      showToast("Those tasks have already been assigned. Refresh suggestions and try again.");
      return;
    }
    try {
      for (const { task } of changed) await updateWorkspaceTask(supabase, task, team);
      persist();
    } catch (error) {
      try {
        const rows = await fetchWorkspaceTasks(supabase);
        tasks = rows.map((row) => workspaceTaskFromRow(row, team));
      } catch (refreshError) {
        showToast(`Assignments may have partially saved. Couldn't reload tasks: ${refreshError.message}`);
        return;
      }
      activities = activities.slice(changed.length);
      render();
      showToast(`Some assignments may not have saved: ${error.message}`);
      return;
    }
    render();
    $("#adminMatchModal").close();
    showToast(`${changed.length} skill-based ${changed.length === 1 ? "assignment" : "assignments"} saved.`);
  });
  $("#adminSuggestionList").addEventListener("change", (event) => {
    const ownerSelect = event.target.closest("[data-suggestion-owner]");
    if (!ownerSelect || !ownerSelect.value) return;
    const checkbox = $("#adminSuggestionList").querySelector(`input[type='checkbox'][value="${ownerSelect.dataset.suggestionOwner}"]`);
    if (checkbox) checkbox.checked = true;
  });
  try {
    let rows = await fetchWorkspaceTasks(supabase);
    if (!rows.length) {
      rows = await importLegacyWorkspaceTasks(supabase, tasks, team);
    }
    tasks = rows.map((row) => workspaceTaskFromRow(row, team));
    persist();
  } catch (error) {
    showToast(`Couldn't load shared tasks: ${error.message}`);
  }
  render();
  try {
    workspaceDirectory = await fetchWorkspaceDirectory(supabase);
    renderChatDirectory();
  } catch (error) {
    showToast(`Couldn't load workspace members: ${error.message}`);
  }
  try {
    reports = await fetchEmployeeReports(supabase);
    await renderAdminReports();
  } catch (error) {
    showToast(`Couldn't load report reviews: ${error.message}`);
  }
  try {
    await refreshChats();
  } catch (error) {
    showToast(`Couldn't load chats: ${error.message}`);
  }
  window.setInterval(async () => {
    try {
      const rows = await fetchWorkspaceTasks(supabase);
      tasks = rows.map((row) => workspaceTaskFromRow(row, team));
      if (activeView === "tasks") render();
    } catch (error) {
      showToast(`Couldn't refresh shared tasks: ${error.message}`);
    }
    if (activeView === "messages") {
      try { await refreshChats(); }
      catch (error) { $("#adminChatStatus").textContent = `Sync error: ${error.message}`; }
    }
    if (activeView === "reports") {
      try {
        reports = await fetchEmployeeReports(supabase);
        await renderAdminReports();
      } catch (error) {
        showToast(`Couldn't refresh report reviews: ${error.message}`);
      }
    }
  }, 15000);
})();

import { supabase, supabaseConfigured } from "./supabase-client.js";
import {
  createReportAttachmentLink,
  fetchConversations,
  fetchConversationMessages,
  fetchEmployeeReports,
  fetchWorkspaceDirectory,
  openConversation,
  sendConversationMessage,
  submitEmployeeReport
} from "./workspace-communications.js";

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
const { data: profile, error: profileError } = await supabase.from("profiles")
  .select("full_name, role, skills")
  .eq("id", session.user.id)
  .maybeSingle();
if (profileError || !profile || profile.role !== "employee") {
  if (profile?.role === "admin") window.location.replace("admin.html");
  else {
    await supabase.auth.signOut();
    window.location.replace("login.html");
  }
  return;
}
const currentSession = { name: profile.full_name, role: profile.role, skills: profile.skills || [], email: session.user.email };

const currentMember = {
  id: session.user.id,
  email: currentSession.email,
  name: currentSession.name,
  initials: currentSession.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
  color: "avatar-me",
  role: "Employee",
  skills: currentSession.skills,
  capacity: 70
};
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
const savedState = (() => {
  try { return JSON.parse(localStorage.getItem("orbit-workspace") || "{}"); }
  catch { return {}; }
})();
const importedTeam = Array.isArray(savedState.team) ? savedState.team.filter((member) => member.id && member.email) : [];
let team = [...importedTeam.filter((member) => member.name !== currentSession.name), currentMember];
let tasks = Array.isArray(savedState.tasks) ? savedState.tasks : initialTasks;
let activities = Array.isArray(savedState.activities) ? savedState.activities : [];
let assignmentsNeedCleanup = false;
tasks.forEach((task) => {
  if (task.assignee && !team.some((member) => member.name === task.assignee)) {
    task.assignee = "";
    assignmentsNeedCleanup = true;
  }
});
let activeFilter = "all";
let activeView = "dashboard";
let workspaceDirectory = [];
let conversations = [];
let selectedConversationId = null;
let expandedWorkloadMember = null;
let showAllWorkload = false;
let showAllActivity = false;
let reports = [];
let toastTimer;

const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
function persist() {
  try { localStorage.setItem("orbit-workspace", JSON.stringify({ team, tasks, activities })); }
  catch { showToast("Your browser couldn't save changes. Check available storage."); }
}
if (assignmentsNeedCleanup || importedTeam.length !== (Array.isArray(savedState.team) ? savedState.team.length : 0)) persist();
function memberFor(name) { return team.find((member) => member.name === name); }
function shortDate(value) {
  if (!value) return "No date";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function isDueThisWeek(task) {
  if (!task.due || task.status === "Completed") return false;
  const due = new Date(`${task.due}T12:00:00`);
  if (Number.isNaN(due.getTime())) return false;
  const daysUntilDue = (due - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000;
  return daysUntilDue >= 0 && daysUntilDue <= 7;
}
function renderTasks() {
  const search = ($("#searchInput").value || "").trim().toLowerCase();
  let visible = tasks.filter((task) => {
    if (task.assignee !== currentSession.name) return false;
    const filterMatch = activeFilter === "all"
      || activeFilter === "active" && task.status !== "Completed"
      || activeFilter === "completed" && task.status === "Completed"
      || activeFilter === "due-week" && isDueThisWeek(task)
      || activeFilter === "review" && task.status === "In review"
      || task.status.toLowerCase() === activeFilter;
    const searchMatch = !search || `${task.title} ${task.project} ${task.assignee} ${task.skill}`.toLowerCase().includes(search);
    return filterMatch && searchMatch;
  });
  if (activeView === "dashboard") visible = visible.slice(0, 6);
  $("#taskRows").innerHTML = visible.map((task) => {
    const member = memberFor(task.assignee);
    const statusClass = task.status.toLowerCase().replaceAll(" ", "-");
    return `<tr>
      <td><div class="task-name"><span class="task-checkbox ${task.status === "Completed" ? "done" : ""}">${task.status === "Completed" ? "✓" : ""}</span><span>${escapeHTML(task.title)}</span></div><div class="task-project">${escapeHTML(task.project)}</div></td>
      <td>${member ? `<div class="assignee-cell"><span class="avatar avatar-small ${escapeHTML(member.color)}">${escapeHTML(member.initials)}</span><span class="assignee-name">${escapeHTML(member.name.split(" ")[0])}</span></div>` : `<span class="assignee-name unassigned-name">Unassigned</span>`}</td>
      <td><span class="priority priority-${task.priority.toLowerCase()}">${escapeHTML(task.priority)}</span></td>
      <td><span class="due-cell">${escapeHTML(shortDate(task.due))}</span></td>
      <td><span class="status-pill status-${statusClass}">${escapeHTML(task.status)}</span></td>
      <td><button class="row-more" data-task-action="${task.id}" aria-label="Update task status">···</button></td>
    </tr>`;
  }).join("");
  $("#emptyTasks").classList.toggle("hidden", visible.length !== 0);
  const myTasks = tasks.filter((task) => task.assignee === currentSession.name);
  $("#taskCountLabel").textContent = `Showing ${visible.length} of ${myTasks.length} assigned tasks`;
  $("#allTaskCount").textContent = myTasks.length;
  $("#taskNavCount").textContent = myTasks.filter((task) => task.status !== "Completed").length;
  const activeTasks = myTasks.filter((task) => task.status !== "Completed");
  const dueThisWeek = activeTasks.filter(isDueThisWeek).length;
  $("#activeTasks").textContent = activeTasks.length;
  $("#completedTasks").textContent = myTasks.filter((task) => task.status === "Completed").length;
  $("#dueTasks").textContent = dueThisWeek;
}
function renderWorkload() {
  const displayedMembers = showAllWorkload ? team : team.slice(0, 4);
  $("#workloadList").innerHTML = displayedMembers.map((member) => {
    const memberTasks = tasks.filter((task) => task.assignee === member.name);
    const assigned = memberTasks.filter((task) => task.status !== "Completed").length;
    const load = Math.min(99, Math.max(member.capacity, assigned * 18));
    const isExpanded = expandedWorkloadMember === member.id;
    const taskDetails = memberTasks.length
      ? memberTasks.map((task) => `<li><span>${escapeHTML(task.title)}</span><small>${escapeHTML(task.status)}</small></li>`).join("")
      : "<li><span>No assigned tasks</span></li>";
    return `<div class="workload-member-wrap${isExpanded ? " expanded" : ""}">
      <button class="member-workload" type="button" data-workload-member="${escapeHTML(member.id)}" aria-expanded="${isExpanded}">
        <span class="avatar avatar-small ${escapeHTML(member.color)}">${escapeHTML(member.initials)}</span>
        <span class="member-info"><span class="member-name">${escapeHTML(member.name)}</span><span class="member-load">${load}%</span><span class="load-track"><span style="width:${load}%"></span></span></span>
        <span class="workload-number">${assigned} active</span>
      </button>
      <ul class="workload-task-details${isExpanded ? "" : " hidden"}">${taskDetails}</ul>
    </div>`;
  }).join("");
  $("#workloadMoreButton").textContent = showAllWorkload || team.length <= 4 ? "Team workload" : `See all ${team.length} members`;
  $("#workloadMoreButton").setAttribute("aria-expanded", String(showAllWorkload));
  $("#workloadMoreButton").disabled = team.length <= 4;
}
function renderActivity() {
  const entries = showAllActivity ? activities : activities.slice(0, 4);
  $("#activityList").innerHTML = entries.map((entry) => `<div class="activity-item"><span class="avatar avatar-small activity-avatar ${escapeHTML(entry.color)}">${escapeHTML(entry.initials)}</span><div class="activity-copy"><strong>${escapeHTML(entry.name.split(" ")[0])}</strong> ${entry.text}<small>${escapeHTML(entry.time)}</small></div></div>`).join("");
  $("#activityMoreButton").textContent = showAllActivity || activities.length <= 4 ? "Recent activity" : `See all ${activities.length}`;
  $("#activityMoreButton").setAttribute("aria-expanded", String(showAllActivity));
  $("#activityMoreButton").disabled = activities.length <= 4;
}
function renderReportTasks() {
  const selection = $("#reportTask").value;
  const myTasks = tasks.filter((task) => task.assignee === currentSession.name);
  $("#reportTask").innerHTML = '<option value="">General team update</option>' + myTasks.map((task) => `<option value="${task.id}">${escapeHTML(task.title)}</option>`).join("");
  if (myTasks.some((task) => String(task.id) === selection)) $("#reportTask").value = selection;
}
function renderAll() { renderTasks(); renderWorkload(); renderActivity(); renderReportTasks(); }
function directoryName(id) {
  return workspaceDirectory.find((person) => person.id === id)?.full_name || "Workspace member";
}
function chatPartner(conversation) {
  const id = conversation.participant_one === currentMember.id ? conversation.participant_two : conversation.participant_one;
  return workspaceDirectory.find((person) => person.id === id);
}
function renderChatDirectory() {
  const options = workspaceDirectory.filter((person) => person.id !== currentMember.id)
    .map((person) => `<option value="${escapeHTML(person.id)}">${escapeHTML(person.full_name)} · ${escapeHTML(person.role)}</option>`)
    .join("");
  $("#employeeChatPartner").innerHTML = options || '<option value="">No other workspace members</option>';
  if (!selectedConversationId && conversations.length) selectedConversationId = conversations[0].id;
  const search = ($("#searchInput").value || "").trim().toLowerCase();
  const visible = conversations.filter((conversation) => {
    const person = chatPartner(conversation);
    return !search || `${person?.full_name || ""} ${conversation.last_message?.body || ""}`.toLowerCase().includes(search);
  });
  $("#employeeConversationList").innerHTML = visible.map((conversation) => {
    const person = chatPartner(conversation);
    const lastMessage = conversation.last_message;
    return `<button type="button" class="chat-conversation${selectedConversationId === conversation.id ? " active" : ""}" data-employee-conversation="${escapeHTML(conversation.id)}">
      <span class="chat-person-avatar">${escapeHTML((person?.full_name || "W").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase())}</span>
      <span class="chat-conversation-copy"><strong>${escapeHTML(person?.full_name || "Workspace member")}</strong><small>${escapeHTML(lastMessage?.body || "Start the conversation")}</small></span>
      <time>${lastMessage ? new Date(lastMessage.created_at).toLocaleDateString() : ""}</time>
    </button>`;
  }).join("") || '<div class="admin-message-empty">No conversations yet.</div>';
}
async function renderChatThread() {
  const conversation = conversations.find((item) => item.id === selectedConversationId);
  const partner = conversation && chatPartner(conversation);
  $("#employeeChatTitle").textContent = partner?.full_name || "Select a conversation";
  $("#employeeChatStatus").textContent = partner?.role || "";
  $("#employeeChatInput").disabled = !conversation;
  $("#employeeChatForm button").disabled = !conversation;
  if (!conversation) {
    $("#employeeChatMessages").innerHTML = '<div class="admin-message-empty">Choose a teammate to open a chat.</div>';
    return;
  }
  try {
    const thread = await fetchConversationMessages(supabase, conversation.id);
    $("#employeeChatMessages").innerHTML = thread.map((message) => {
      const own = message.sender_id === currentMember.id;
      return `<article class="chat-bubble-row ${own ? "own" : ""}"><div class="chat-bubble"><strong>${escapeHTML(own ? "You" : directoryName(message.sender_id))}</strong><p>${escapeHTML(message.body)}</p><time>${escapeHTML(new Date(message.created_at).toLocaleString())}</time></div></article>`;
    }).join("") || '<div class="admin-message-empty">No messages yet. Say hello.</div>';
    $("#employeeChatMessages").scrollTop = $("#employeeChatMessages").scrollHeight;
  } catch (error) {
    showToast(`Couldn't load conversation: ${error.message}`);
  }
}
async function refreshChats() {
  conversations = await fetchConversations(supabase, currentMember.id);
  if (selectedConversationId && !conversations.some((conversation) => conversation.id === selectedConversationId)) selectedConversationId = null;
  renderChatDirectory();
  await renderChatThread();
}
function renderEmployeeReportCards(container, emptyState, limit = Infinity) {
  const search = container.id === "employeeReportsList" ? ($("#searchInput").value || "").trim().toLowerCase() : "";
  const matched = reports.filter((report) =>
    !search || `${report.task_title} ${report.body} ${report.status} ${report.review_note || ""}`.toLowerCase().includes(search)
  );
  const visible = matched.slice(0, limit);
  container.innerHTML = visible.map((report) => {
    const task = report.task_title ? `<span>${escapeHTML(report.task_title)}</span>` : "";
    const review = report.review_note ? `<p class="employee-report-review-note">Review note: ${escapeHTML(report.review_note)}</p>` : "";
    const file = report.attachment_name ? `<span class="employee-report-file">${escapeHTML(report.attachment_name)} · ${(report.attachment_size / (1024 * 1024)).toFixed(2)} MB</span>` : "";
    return `<article class="employee-report-card"><div class="employee-report-card-heading"><strong>${escapeHTML(new Date(report.created_at).toLocaleString())}</strong><span class="report-status report-status-${escapeHTML(report.status)}">${escapeHTML(report.status)}</span></div>${task}<p>${escapeHTML(report.body)}</p>${file}${review}</article>`;
  }).join("");
  emptyState.classList.toggle("hidden", visible.length > 0);
}
async function refreshEmployeeReports() {
  reports = await fetchEmployeeReports(supabase);
  renderEmployeeReportCards($("#employeeDashboardReportList"), $("#employeeDashboardReportsEmpty"), 5);
  renderEmployeeReportCards($("#employeeReportsList"), $("#employeeReportsEmpty"));
}
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}
function openModal(id) { $(id).showModal(); }
function closeModal(button) { button.closest("dialog").close(); }
function setView(view) {
  activeView = view;
  const isMessages = view === "messages";
  const isReports = view === "reports";
  const isTasks = view === "tasks";
  $("#employeeDashboardView").classList.toggle("hidden", view !== "dashboard");
  $("#employeeTasksView").classList.toggle("hidden", !isTasks);
  $("#employeeMessagesView").classList.toggle("hidden", !isMessages);
  $("#employeeReportsView").classList.toggle("hidden", !isReports);
  const label = { dashboard: "Dashboard", tasks: "Tasks", reports: "Reports", messages: "Chats" }[view] || "Dashboard";
  $("#breadcrumbCurrent").textContent = label;
  document.querySelectorAll(".nav-link[data-view]").forEach((link) => link.classList.toggle("active", link.dataset.view === view));
  $("#sidebar").classList.remove("open");
  activeFilter = "all";
  document.querySelectorAll(".filter-button").forEach((button) => button.classList.toggle("selected", button.dataset.filter === "all"));
  if (isMessages) refreshChats().catch((error) => showToast(`Couldn't load chats: ${error.message}`));
  else if (isReports) refreshEmployeeReports().catch((error) => showToast(`Couldn't load reports: ${error.message}`));
  else if (isTasks) renderTasks();
  else renderAll();
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelectorAll(".filter-button").forEach((button) => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll(".filter-button").forEach((item) => item.classList.toggle("selected", item === button));
  renderTasks();
}));
function openTaskFilter(filter) {
  setView("tasks");
  activeFilter = filter;
  document.querySelectorAll(".filter-button").forEach((button) => button.classList.toggle("selected", button.dataset.filter === filter));
  renderTasks();
}
function activateOnKeyboard(event, action) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}
document.querySelectorAll("[data-task-filter]").forEach((card) => {
  const action = () => openTaskFilter(card.dataset.taskFilter);
  card.addEventListener("click", action);
  card.addEventListener("keydown", (event) => activateOnKeyboard(event, action));
});
$("#workloadList").addEventListener("click", (event) => {
  const memberButton = event.target.closest("[data-workload-member]");
  if (!memberButton) return;
  expandedWorkloadMember = expandedWorkloadMember === memberButton.dataset.workloadMember ? null : memberButton.dataset.workloadMember;
  renderWorkload();
});
$("#workloadMoreButton").addEventListener("click", () => {
  showAllWorkload = !showAllWorkload;
  renderWorkload();
});
$("#activityMoreButton").addEventListener("click", () => {
  showAllActivity = !showAllActivity;
  renderActivity();
});
$("#searchInput").addEventListener("input", () => {
  if (activeView === "messages") renderChatDirectory();
  else if (activeView === "reports") renderEmployeeReportCards($("#employeeReportsList"), $("#employeeReportsEmpty"));
  else renderTasks();
});
$("#reportButton").addEventListener("click", () => openModal("#reportModal"));
$("#employeeNewReportButton").addEventListener("click", () => openModal("#reportModal"));
$("#messageButton").addEventListener("click", () => setView("messages"));
$("#employeeStartChat").addEventListener("click", async () => {
  try {
    const conversation = await openConversation(supabase, currentMember.id, $("#employeeChatPartner").value);
    selectedConversationId = conversation.id;
    await refreshChats();
  } catch (error) {
    showToast(`Couldn't open chat: ${error.message}`);
  }
});
$("#employeeConversationList").addEventListener("click", async (event) => {
  const item = event.target.closest("[data-employee-conversation]");
  if (!item) return;
  selectedConversationId = item.dataset.employeeConversation;
  renderChatDirectory();
  await renderChatThread();
});
$("#employeeChatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#employeeChatInput");
  const body = input.value.trim();
  if (!selectedConversationId || !body) return;
  input.disabled = true;
  $("#employeeChatForm button").disabled = true;
  try {
    await sendConversationMessage(supabase, selectedConversationId, currentMember.id, body);
    input.value = "";
    await refreshChats();
  } catch (error) {
    showToast(`Couldn't send message: ${error.message}`);
  } finally {
    input.disabled = !selectedConversationId;
    $("#employeeChatForm button").disabled = !selectedConversationId;
  }
});
$("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#notificationButton").addEventListener("click", () => showToast("You're all caught up."));
$("#settingsButton").addEventListener("click", () => showToast("Workspace settings are coming soon."));
$("#exploreButton").addEventListener("click", () => showToast("You're already using TEAM FLOW Intelligence ✳"));
$(".profile-button").addEventListener("click", () => {
  supabase.auth.signOut().then(({ error }) => {
    if (error) showToast(`Couldn't sign out: ${error.message}`);
    else window.location.replace("login.html");
  });
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal(button)));
document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
}));

$("#reportAttachment").addEventListener("change", (event) => {
  const file = event.currentTarget.files?.[0];
  $("#reportUploadStatus").textContent = file && file.size > 3 * 1024 * 1024 ? "This file is larger than the 3 MB limit." : "";
});
$("#reportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("#reportText").value.trim();
  if (!text) return;
  const task = tasks.find((item) => item.id === Number($("#reportTask").value));
  const submitButton = $("#reportForm button[type='submit']");
  const attachment = $("#reportAttachment").files?.[0] || null;
  submitButton.disabled = true;
  $("#reportUploadStatus").textContent = attachment ? "Uploading your report and attachment…" : "Submitting your report…";
  try {
    await submitEmployeeReport(supabase, {
      employeeId: currentMember.id,
      taskTitle: task?.title || "",
      body: text,
      file: attachment
    });
    $("#reportForm").reset();
    $("#reportUploadStatus").textContent = "";
    $("#reportModal").close();
    showToast("Your report was submitted for review.");
    try {
      await refreshEmployeeReports();
    } catch (error) {
      showToast(`Report submitted, but its review status couldn't refresh: ${error.message}`);
    }
  } catch (error) {
    $("#reportUploadStatus").textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});
$("#taskRows").addEventListener("click", (event) => {
  const button = event.target.closest("[data-task-action]");
  if (!button) return;
  const task = tasks.find((item) => item.id === Number(button.dataset.taskAction));
  if (!task || task.assignee !== currentSession.name) return;
  const nextStatus = { "To do": "In progress", "In progress": "In review", "In review": "Completed", Completed: "To do" };
  task.status = nextStatus[task.status] || "To do";
  persist(); renderAll(); showToast(`Task marked ${task.status.toLowerCase()}.`);
});

const today = new Date();
$("#todayDate").textContent = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase();
const signedInMember = memberFor(currentSession.name);
if (signedInMember) {
  $("#pageTitle").textContent = `Welcome, ${currentSession.name.split(" ")[0]}`;
  $(".profile-copy strong").textContent = currentSession.name;
  $(".profile-copy small").textContent = signedInMember.role;
  $(".profile-button .avatar").textContent = signedInMember.initials;
  $(".profile-button .avatar").className = `avatar ${signedInMember.color}`;
  $("#topAvatar").textContent = signedInMember.initials;
  $("#topAvatar").className = `avatar top-avatar ${signedInMember.color}`;
}
renderAll();
try {
  workspaceDirectory = await fetchWorkspaceDirectory(supabase);
  team = workspaceDirectory.map((person, index) => ({
    id: person.id,
    name: person.full_name,
    initials: person.full_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
    color: person.id === currentMember.id ? "avatar-me" : ["avatar-blue", "avatar-green", "avatar-violet", "avatar-amber"][index % 4],
    role: person.role === "admin" ? "Administrator" : "Employee",
    skills: person.id === currentMember.id ? currentSession.skills : [],
    capacity: 70
  }));
  renderAll();
} catch (error) {
  showToast(`Couldn't load workspace members: ${error.message}`);
}
try {
  await refreshEmployeeReports();
} catch (error) {
  showToast(`Couldn't load report reviews: ${error.message}`);
}
try {
  await refreshChats();
} catch (error) {
  showToast(`Couldn't load chats: ${error.message}`);
}
window.setInterval(async () => {
  if (activeView === "messages") {
    try { await refreshChats(); }
    catch (error) { $("#employeeChatStatus").textContent = `Sync error: ${error.message}`; }
  }
  if (activeView === "reports" || activeView === "dashboard") {
    try { await refreshEmployeeReports(); }
    catch (error) { showToast(`Couldn't refresh report reviews: ${error.message}`); }
  }
}, 15000);

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $("#searchInput").focus();
  }
  if (event.key === "Escape") $("#sidebar").classList.remove("open");
});
})();

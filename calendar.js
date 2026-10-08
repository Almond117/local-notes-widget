"use strict";

const STORAGE_KEY = "local-notes-widget-v1";
const monthLabel = document.querySelector("#monthLabel");
const grid = document.querySelector("#calendarGrid");
const summary = document.querySelector("#taskSummary");
let cursor = new Date();
let tasks = [];
let state = null;
let selectedKey = dateKey(new Date());
let activeDirection = "all";

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function dateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function taskDate(task) {
  return dateKey(task.reminderAt || task.createdAt);
}

function formatKey(key) {
  const [year, month, day] = key.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function categoryColor(task) {
  const directionColors = { 工作: "#85b9f1", 创业: "#f78eb8", 学习: "#ffdf55" };
  return directionColors[task.direction] || state?.categories?.find((category) => category.id === task.categoryId)?.color || "#8bbcec";
}

function matchesDirection(task) {
  return activeDirection === "all" || (task.direction || "工作") === activeDirection;
}

function render() {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  monthLabel.textContent = `${year}年 ${month + 1}月`;
  document.querySelector("#sideDate").textContent = formatKey(selectedKey);
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const leading = first.getDay();
  const total = Math.ceil((leading + days) / 7) * 7;
  const today = dateKey(new Date());
  const byDate = new Map();
  tasks.filter(matchesDirection).forEach((task) => {
    const key = taskDate(task);
    if (!key) return;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(task);
  });
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthTasks = [...byDate.entries()].filter(([key]) => key.startsWith(monthPrefix)).reduce((sum, [, list]) => sum + list.length, 0);
  summary.textContent = `${monthTasks} 项待办`;
  grid.innerHTML = Array.from({ length: total }, (_, index) => {
    const day = index - leading + 1;
    const inMonth = day > 0 && day <= days;
    if (!inMonth) return `<div class="day-cell outside" aria-hidden="true"></div>`;
    const key = `${monthPrefix}-${String(day).padStart(2, "0")}`;
    const dayTasks = byDate.get(key) || [];
    const taskMarkup = dayTasks.slice(0, 4).map((task) => `<div class="calendar-task${task.completedAt ? " completed" : ""}" style="--task-color:${categoryColor(task)}" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</div>`).join("");
    const more = dayTasks.length > 4 ? `<div class="more-tasks">还有 ${dayTasks.length - 4} 项</div>` : "";
    return `<article class="day-cell${key === today ? " today" : ""}"><div class="day-number">${day}</div><div class="day-tasks">${taskMarkup}${more}</div></article>`;
  }).join("");
  grid.querySelectorAll(".day-cell:not(.outside)").forEach((cell) => cell.addEventListener("click", () => {
    const day = Number(cell.querySelector(".day-number").textContent);
    selectedKey = `${monthPrefix}-${String(day).padStart(2, "0")}`;
    renderDetail();
  }));
}

function renderDetail() {
  const detail = document.querySelector("#dayDetail");
  const list = document.querySelector("#detailTasks");
  const dayTasks = tasks.filter((task) => taskDate(task) === selectedKey && matchesDirection(task));
  document.querySelector("#detailDate").textContent = formatKey(selectedKey);
  document.querySelector("#sideDate").textContent = formatKey(selectedKey);
  document.querySelector("#detailSummary").textContent = `${dayTasks.filter((task) => !task.completedAt).length} 项待完成 · ${dayTasks.filter((task) => task.completedAt).length} 项已完成`;
  list.innerHTML = dayTasks.length ? dayTasks.map((task) => `<div class="detail-task${task.completedAt ? " completed" : ""}" style="--task-color:${categoryColor(task)}" data-detail-task-id="${escapeHtml(task.id)}"><button class="detail-check" type="button" data-detail-action="toggle" aria-label="${task.completedAt ? "恢复" : "完成"}">${task.completedAt ? "✓" : ""}</button><span class="detail-title" title="双击修改">${escapeHtml(task.title)}</span><button class="detail-edit" type="button" data-detail-action="edit" aria-label="编辑">✎</button><button class="detail-delete" type="button" data-detail-action="delete" aria-label="删除">×</button></div>`).join("") : `<div class="detail-empty">这一天还没有安排</div>`;
  detail.hidden = false;
}

async function load() {
  const saved = await window.desktopAPI?.loadState();
  state = saved || { tasks: [], categories: [] };
  if (saved?.tasks) tasks = saved.tasks;
  else {
    try { tasks = JSON.parse(localStorage.getItem(STORAGE_KEY))?.tasks || []; } catch { tasks = []; }
  }
  render();
}

document.querySelector("#previousMonth").addEventListener("click", () => { cursor.setMonth(cursor.getMonth() - 1); render(); });
document.querySelector("#nextMonth").addEventListener("click", () => { cursor.setMonth(cursor.getMonth() + 1); render(); });
document.querySelector("#todayButton").addEventListener("click", () => { cursor = new Date(); render(); });
document.querySelector("#closeCalendar").addEventListener("click", () => window.desktopAPI?.closeCalendar());
document.querySelector("#closeDetail").addEventListener("click", () => { document.querySelector("#dayDetail").hidden = true; });
document.querySelector("#sideAddButton").addEventListener("click", () => {
  renderDetail();
  document.querySelector("#detailInput").focus();
});
document.querySelector("#detailTasks").addEventListener("click", async (event) => {
  const row = event.target.closest("[data-detail-task-id]");
  const action = event.target.closest("[data-detail-action]")?.dataset.detailAction;
  if (!row || !action) return;
  const task = tasks.find((item) => item.id === row.dataset.detailTaskId);
  if (!task) return;
  if (action === "toggle") task.completedAt = task.completedAt ? null : new Date().toISOString();
  if (action === "edit") {
    const nextTitle = window.prompt("修改便签内容", task.title);
    if (nextTitle === null || !nextTitle.trim()) return;
    task.title = nextTitle.trim().slice(0, 120);
  }
  if (action === "delete") {
    if (!window.confirm(`删除「${task.title}」？`)) return;
    state.tasks = state.tasks.filter((item) => item.id !== task.id);
    tasks = state.tasks;
  }
  await window.desktopAPI?.saveState(state);
  render();
  renderDetail();
});
document.querySelector("#detailForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#detailInput");
  const title = input.value.trim();
  if (!title || !state) return;
  const completed = event.submitter?.dataset.completed === "true";
  const [year, month, day] = selectedKey.split("-").map(Number);
  const createdAt = new Date(year, month - 1, day, 12, 0, 0).toISOString();
  const categoryId = state.categories?.find((category) => category.id === state.selectedCategoryId)?.id || state.categories?.[0]?.id || "other";
  const direction = document.querySelector("#detailDirection").value;
  const task = { id: `task-calendar-${Date.now()}-${Math.random().toString(16).slice(2)}`, title, direction, categoryId, createdAt };
  if (completed) task.completedAt = new Date().toISOString();
  state.tasks = Array.isArray(state.tasks) ? [...state.tasks, task] : [task];
  tasks = state.tasks;
  await window.desktopAPI?.saveState(state);
  input.value = "";
  render();
  renderDetail();
});
load();

document.querySelectorAll(".direction-filter").forEach((button) => button.addEventListener("click", () => {
  activeDirection = button.dataset.direction;
  document.querySelectorAll(".direction-filter").forEach((item) => item.classList.toggle("active", item === button));
  render();
  if (!document.querySelector("#dayDetail").hidden) renderDetail();
}));

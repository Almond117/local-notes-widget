"use strict";

const STORAGE_KEY = "local-notes-widget-v1";
const monthLabel = document.querySelector("#monthLabel");
const grid = document.querySelector("#calendarGrid");
const summary = document.querySelector("#taskSummary");
let cursor = new Date();
let tasks = [];

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

function render() {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  monthLabel.textContent = `${year}年 ${month + 1}月`;
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const leading = first.getDay();
  const total = Math.ceil((leading + days) / 7) * 7;
  const today = dateKey(new Date());
  const byDate = new Map();
  tasks.filter((task) => !task.completedAt).forEach((task) => {
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
    const taskMarkup = dayTasks.slice(0, 4).map((task) => `<div class="calendar-task" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</div>`).join("");
    const more = dayTasks.length > 4 ? `<div class="more-tasks">还有 ${dayTasks.length - 4} 项</div>` : "";
    return `<article class="day-cell${key === today ? " today" : ""}"><div class="day-number">${day}</div><div class="day-tasks">${taskMarkup}${more}</div></article>`;
  }).join("");
}

async function load() {
  const saved = await window.desktopAPI?.loadState();
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
load();

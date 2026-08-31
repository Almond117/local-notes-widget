(function () {
  "use strict";

  const STORAGE_KEY = "local-notes-widget-v1";
  const DATA_VERSION = 3;

  const defaultCategories = [
    { id: "ccfa", name: "CCF-A", color: "#f58bb1" },
    { id: "ccfb", name: "CCF-B", color: "#f4cf65" },
    { id: "ccfc", name: "CCF-C", color: "#92dc4c" },
    { id: "other", name: "other", color: "#f5dc75" },
    { id: "journal", name: "期刊", color: "#76d8dc" },
    { id: "paper", name: "paper", color: "#a9a0f3" },
    { id: "power", name: "power", color: "#ec8c82" },
    { id: "think", name: "think", color: "#aeb2b7" },
    { id: "misc", name: "！干！", color: "#89b6ef" }
  ];

  const initialState = {
    dataVersion: DATA_VERSION,
    selectedCategoryId: "all",
    completedExpanded: true,
    skinColor: null,
    panelOpacity: 86,
    deletedTasks: [],
    categories: structuredClone(defaultCategories),
    tasks: []
  };

  function normalizeOpacity(value, legacyTransparentMode = false) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.min(100, Math.max(25, Math.round(numeric)));
    return legacyTransparentMode ? 55 : 86;
  }

  function migrateState(saved) {
    if (!saved || !Array.isArray(saved.categories) || !Array.isArray(saved.tasks)) {
      return structuredClone(initialState);
    }

    const migrated = {
      ...structuredClone(initialState),
      ...saved,
      panelOpacity: normalizeOpacity(saved.panelOpacity, saved.transparentMode),
      deletedTasks: Array.isArray(saved.deletedTasks) ? saved.deletedTasks : []
    };

    migrated.dataVersion = DATA_VERSION;
    delete migrated.transparentMode;
    return migrated;
  }

  const elements = {
    board: document.querySelector(".note-board"),
    searchButton: document.querySelector("#searchButton"),
    pinButton: document.querySelector("#pinButton"),
    themeButton: document.querySelector("#themeButton"),
    minimizeButton: document.querySelector("#minimizeButton"),
    appMenuButton: document.querySelector("#appMenuButton"),
    closeButton: document.querySelector("#closeButton"),
    searchPanel: document.querySelector("#searchPanel"),
    searchInput: document.querySelector("#searchInput"),
    searchResultCount: document.querySelector("#searchResultCount"),
    closeSearchButton: document.querySelector("#closeSearchButton"),
    categoryList: document.querySelector("#categoryList"),
    addCategoryButton: document.querySelector("#addCategoryButton"),
    allTasksButton: document.querySelector("#allTasksButton"),
    currentCategoryName: document.querySelector("#currentCategoryName"),
    activeCount: document.querySelector("#activeCount"),
    openComposerButton: document.querySelector("#openComposerButton"),
    composer: document.querySelector("#composer"),
    taskInput: document.querySelector("#taskInput"),
    newTaskReminderInput: document.querySelector("#newTaskReminderInput"),
    composerCategory: document.querySelector("#composerCategory"),
    cancelComposerButton: document.querySelector("#cancelComposerButton"),
    activeTaskList: document.querySelector("#activeTaskList"),
    completedToggle: document.querySelector("#completedToggle"),
    completedCount: document.querySelector("#completedCount"),
    completedTaskList: document.querySelector("#completedTaskList"),
    emptyState: document.querySelector("#emptyState"),
    menu: document.querySelector("#menu"),
    appMenu: document.querySelector("#appMenu"),
    skinPopover: document.querySelector("#skinPopover"),
    customColorInput: document.querySelector("#customColorInput"),
    followCategoryButton: document.querySelector("#followCategoryButton"),
    opacityRange: document.querySelector("#opacityRange"),
    opacityValue: document.querySelector("#opacityValue"),
    categoryFooter: document.querySelector("#categoryFooter"),
    categoryDialog: document.querySelector("#categoryDialog"),
    categoryForm: document.querySelector("#categoryForm"),
    categoryNameInput: document.querySelector("#categoryNameInput"),
    reminderDialog: document.querySelector("#reminderDialog"),
    reminderForm: document.querySelector("#reminderForm"),
    reminderDateInput: document.querySelector("#reminderDateInput"),
    clearReminderButton: document.querySelector("#clearReminderButton"),
    categoryManagerDialog: document.querySelector("#categoryManagerDialog"),
    categoryManagerList: document.querySelector("#categoryManagerList"),
    closeCategoryManagerButton: document.querySelector("#closeCategoryManagerButton"),
    recycleDialog: document.querySelector("#recycleDialog"),
    recycleList: document.querySelector("#recycleList"),
    recycleCount: document.querySelector("#recycleCount"),
    closeRecycleButton: document.querySelector("#closeRecycleButton"),
    emptyRecycleButton: document.querySelector("#emptyRecycleButton"),
    autoLaunchMenuItem: document.querySelector("#autoLaunchMenuItem"),
    toast: document.querySelector("#toast"),
    toastMessage: document.querySelector("#toastMessage"),
    toastAction: document.querySelector("#toastAction")
  };

  let state = loadState();
  let menuTaskId = null;
  let toastTimer = null;
  let toastActionHandler = null;
  let reminderTaskId = null;
  let lastDeletedTaskId = null;
  let searchQuery = "";

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.categories) && Array.isArray(saved.tasks)) {
        const migrated = migrateState(saved);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch (error) {
      console.warn("读取本地便签失败，将使用初始内容。", error);
    }
    return structuredClone(initialState);
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.desktopAPI?.saveState(state).catch((error) => console.warn("保存桌面数据失败", error));
  }

  function uid(prefix) {
    if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function highlightedTitle(value) {
    if (!searchQuery) return escapeHtml(value);
    const source = String(value);
    const lowerSource = source.toLocaleLowerCase("zh-CN");
    const lowerQuery = searchQuery.toLocaleLowerCase("zh-CN");
    const parts = [];
    let cursor = 0;
    let matchIndex = lowerSource.indexOf(lowerQuery, cursor);
    while (matchIndex !== -1) {
      parts.push(escapeHtml(source.slice(cursor, matchIndex)));
      parts.push(`<mark>${escapeHtml(source.slice(matchIndex, matchIndex + searchQuery.length))}</mark>`);
      cursor = matchIndex + searchQuery.length;
      matchIndex = lowerSource.indexOf(lowerQuery, cursor);
    }
    parts.push(escapeHtml(source.slice(cursor)));
    return parts.join("");
  }

  function isDarkColor(color) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return false;
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    return red * 0.299 + green * 0.587 + blue * 0.114 < 88;
  }

  function surfaceColor(color, opacity, whiteMix = 0) {
    const fallback = "#89b6ef";
    const source = /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
    const channel = (start) => Number.parseInt(source.slice(start, start + 2), 16);
    const mix = (value) => Math.round(value * (1 - whiteMix) + 255 * whiteMix);
    return `rgba(${mix(channel(1))}, ${mix(channel(3))}, ${mix(channel(5))}, ${opacity.toFixed(2)})`;
  }

  function applyAppearance(boardColor) {
    const opacityPercent = normalizeOpacity(state.panelOpacity);
    const opacity = opacityPercent / 100;
    state.panelOpacity = opacityPercent;
    elements.board.style.setProperty("--board-color", boardColor);
    elements.board.style.setProperty("--board-surface", surfaceColor(boardColor, opacity, 0.28));
    elements.board.style.setProperty("--board-header-surface", surfaceColor(boardColor, Math.min(1, opacity + 0.06), 0.16));
    elements.board.style.setProperty("--board-section-surface", surfaceColor(boardColor, Math.min(1, opacity + 0.03), 0.24));
    document.body.classList.toggle("transparent-mode", opacityPercent < 100);
    document.body.classList.toggle("dark-skin", isDarkColor(boardColor));
    elements.opacityRange.value = String(opacityPercent);
    elements.opacityValue.value = `${opacityPercent}%`;
    elements.opacityValue.textContent = `${opacityPercent}%`;
  }

  function selectedCategory() {
    return state.categories.find((item) => item.id === state.selectedCategoryId) || null;
  }

  function filteredTasks() {
    const categoryTasks = searchQuery
      ? state.tasks
      : state.selectedCategoryId === "all"
        ? state.tasks
        : state.tasks.filter((task) => task.categoryId === state.selectedCategoryId);
    if (!searchQuery) return categoryTasks;
    const keyword = searchQuery.toLocaleLowerCase("zh-CN");
    return categoryTasks.filter((task) => task.title.toLocaleLowerCase("zh-CN").includes(keyword));
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    const pad = (number) => String(number).padStart(2, "0");
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function render() {
    renderCategories();
    renderTasks();
    const category = selectedCategory();
    elements.currentCategoryName.textContent = category ? category.name : "全部";
    elements.composerCategory.textContent = `存入：${category ? category.name : "other"}`;
    elements.categoryFooter.textContent = searchQuery ? `搜索：${searchQuery}` : category ? category.name : "全部";
    const boardColor = category?.color || state.skinColor || "#89b6ef";
    applyAppearance(boardColor);
    elements.followCategoryButton.setAttribute("aria-pressed", String(!state.skinColor));
    elements.recycleCount.textContent = String((state.deletedTasks || []).length);
    elements.skinPopover.querySelectorAll("[data-skin-color]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.skinColor.toLowerCase() === String(state.skinColor).toLowerCase()));
    });
    elements.completedToggle.setAttribute("aria-expanded", String(state.completedExpanded));
    elements.completedTaskList.hidden = !state.completedExpanded;
  }

  function renderCategories() {
    const opacity = normalizeOpacity(state.panelOpacity) / 100;
    elements.categoryList.innerHTML = state.categories
      .map((category) => `
        <button
          class="category-tab"
          type="button"
          data-category-id="${escapeHtml(category.id)}"
          style="--tab-color: ${escapeHtml(category.color)}; --tab-surface: ${surfaceColor(category.color, opacity, 0.28)}"
          aria-current="${state.selectedCategoryId === category.id}"
          title="${escapeHtml(category.name)}"
        >${escapeHtml(category.name)}</button>
      `)
      .join("");
  }

  function renderTasks() {
    const tasks = filteredTasks();
    const active = tasks.filter((task) => !task.completedAt).sort(sortOldestFirst);
    const completed = tasks.filter((task) => task.completedAt).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    elements.activeTaskList.innerHTML = active.map(taskTemplate).join("");
    elements.completedTaskList.innerHTML = completed.map(taskTemplate).join("");
    elements.activeCount.textContent = String(active.length);
    elements.completedCount.textContent = String(completed.length);
    elements.searchResultCount.textContent = searchQuery ? `${tasks.length} 条` : "";
    elements.emptyState.hidden = tasks.length !== 0;
    elements.emptyState.querySelector("p").textContent = searchQuery ? "没有找到相关便签" : "这里很安静";
    elements.emptyState.querySelector("span:last-child").textContent = searchQuery ? "换个关键词试试" : "点右上角的 ＋ 写一条便签";
    elements.completedToggle.hidden = false;
  }

  function sortOldestFirst(a, b) {
    return new Date(a.createdAt) - new Date(b.createdAt);
  }

  function taskTemplate(task) {
    const isCompleted = Boolean(task.completedAt);
    const metaLines = [];
    if (isCompleted) metaLines.push(`<span class="task-meta">开始:${formatDate(task.createdAt)}　完成:${formatDate(task.completedAt)}</span>`);
    if (task.reminderAt) {
      const reminderState = task.reminderFiredAt ? "已提醒" : "提醒";
      metaLines.push(`<span class="task-meta reminder-meta">◷ ${reminderState}：${formatDate(task.reminderAt)}</span>`);
    }

    return `
      <li class="task-item" data-task-id="${escapeHtml(task.id)}">
        <button class="task-check" type="button" data-action="toggle" aria-label="${isCompleted ? "恢复" : "完成"} ${escapeHtml(task.title)}">${isCompleted ? "✓" : ""}</button>
        <div class="task-copy">
          <span class="task-title" title="双击修改便签">${highlightedTitle(task.title)}</span>
          ${metaLines.join("")}
        </div>
        <button class="task-more" type="button" data-action="menu" aria-label="更多操作">···</button>
      </li>
    `;
  }

  function selectCategory(categoryId) {
    if (!elements.searchPanel.hidden) closeSearch();
    state.selectedCategoryId = categoryId;
    saveState();
    closeMenu();
    render();
  }

  function openComposer() {
    elements.composer.hidden = false;
    elements.openComposerButton.textContent = "×";
    elements.openComposerButton.setAttribute("aria-label", "关闭新增便签");
    requestAnimationFrame(() => elements.taskInput.focus());
  }

  function closeComposer() {
    elements.composer.hidden = true;
    elements.taskInput.value = "";
    elements.newTaskReminderInput.value = "";
    elements.openComposerButton.textContent = "＋";
    elements.openComposerButton.setAttribute("aria-label", "新增便签");
  }

  function openSearch() {
    closeAppMenu();
    closeSkinPopover();
    elements.searchPanel.hidden = false;
    requestAnimationFrame(() => elements.searchInput.focus());
  }

  function closeSearch() {
    elements.searchPanel.hidden = true;
    elements.searchInput.value = "";
    searchQuery = "";
    render();
  }

  function addTask(title, reminderValue = "") {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const fallbackCategory = state.categories.find((item) => item.id === "other") || state.categories[0];
    state.tasks.push({
      id: uid("task"),
      title: trimmedTitle,
      categoryId: state.selectedCategoryId === "all" ? fallbackCategory?.id || "" : state.selectedCategoryId,
      createdAt: new Date().toISOString(),
      completedAt: null,
      reminderAt: reminderValue ? new Date(reminderValue).toISOString() : null,
      reminderFiredAt: null
    });
    saveState();
    closeComposer();
    render();
    showToast("便签已添加");
  }

  function toggleTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const wasCompleted = Boolean(task.completedAt);
    task.completedAt = wasCompleted ? null : new Date().toISOString();
    saveState();
    render();
    showToast(wasCompleted ? "已恢复到待办" : "完成啦");
  }

  function editTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const nextTitle = window.prompt("修改便签内容", task.title);
    if (nextTitle === null || !nextTitle.trim()) return;
    task.title = nextTitle.trim().slice(0, 120);
    saveState();
    render();
    showToast("修改已保存");
  }

  function startInlineEdit(taskId, titleElement) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task || !titleElement || titleElement.querySelector(".inline-edit-input")) return;
    const input = document.createElement("input");
    input.className = "inline-edit-input";
    input.type = "text";
    input.maxLength = 120;
    input.value = task.title;
    input.setAttribute("aria-label", "修改便签内容");
    titleElement.replaceWith(input);
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const nextTitle = input.value.trim();
      if (save && nextTitle) {
        task.title = nextTitle;
        saveState();
        render();
        showToast("修改已保存");
      } else {
        render();
      }
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function moveTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task || state.categories.length === 0) return;
    const choices = state.categories.map((item, index) => `${index + 1}. ${item.name}`).join("\n");
    const currentIndex = Math.max(0, state.categories.findIndex((item) => item.id === task.categoryId));
    const answer = window.prompt(`输入分类序号：\n${choices}`, String(currentIndex + 1));
    if (answer === null) return;
    const target = state.categories[Number(answer) - 1];
    if (!target) {
      showToast("没有这个分类");
      return;
    }
    task.categoryId = target.id;
    saveState();
    render();
    showToast(`已移到「${target.name}」`);
  }

  function deleteTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task || !window.confirm(`删除「${task.title}」？`)) return;
    if (!Array.isArray(state.deletedTasks)) state.deletedTasks = [];
    const deletedTask = { ...task, deletedAt: new Date().toISOString() };
    state.deletedTasks.unshift(deletedTask);
    state.tasks = state.tasks.filter((item) => item.id !== taskId);
    lastDeletedTaskId = taskId;
    saveState();
    render();
    showToast("已移到回收站", "撤销", () => restoreDeletedTask(taskId));
  }

  function restoreDeletedTask(taskId) {
    if (!Array.isArray(state.deletedTasks)) return;
    const task = state.deletedTasks.find((item) => item.id === taskId);
    if (!task) return;
    const restored = { ...task };
    delete restored.deletedAt;
    if (!state.categories.some((item) => item.id === restored.categoryId)) {
      restored.categoryId = state.categories.find((item) => item.id === "other")?.id || state.categories[0]?.id || "";
    }
    state.deletedTasks = state.deletedTasks.filter((item) => item.id !== taskId);
    if (!state.tasks.some((item) => item.id === taskId)) state.tasks.push(restored);
    lastDeletedTaskId = null;
    saveState();
    render();
    renderRecycleBin();
    showToast("便签已恢复");
  }

  function deleteTaskForever(taskId) {
    if (!Array.isArray(state.deletedTasks)) return;
    const task = state.deletedTasks.find((item) => item.id === taskId);
    if (!task || !window.confirm(`永久删除「${task.title}」？此操作无法撤销。`)) return;
    state.deletedTasks = state.deletedTasks.filter((item) => item.id !== taskId);
    if (lastDeletedTaskId === taskId) lastDeletedTaskId = null;
    saveState();
    render();
    renderRecycleBin();
  }

  function renderRecycleBin() {
    const deleted = Array.isArray(state.deletedTasks) ? state.deletedTasks : [];
    elements.recycleList.innerHTML = deleted.length
      ? deleted.map((task) => `
        <div class="recycle-item" data-deleted-task-id="${escapeHtml(task.id)}">
          <div class="recycle-copy">
            <span class="recycle-title">${escapeHtml(task.title)}</span>
            <span class="recycle-date">删除于 ${formatDate(task.deletedAt)}</span>
          </div>
          <div class="recycle-actions">
            <button data-recycle-action="restore" type="button">恢复</button>
            <button data-recycle-action="delete" class="danger" type="button">永久删除</button>
          </div>
        </div>
      `).join("")
      : '<div class="recycle-empty">回收站是空的</div>';
    elements.emptyRecycleButton.disabled = deleted.length === 0;
  }

  function renderCategoryManager() {
    elements.categoryManagerList.innerHTML = state.categories.map((category, index) => `
      <div class="category-manager-row" data-managed-category-id="${escapeHtml(category.id)}">
        <input data-category-field="color" type="color" value="${escapeHtml(category.color)}" aria-label="${escapeHtml(category.name)} 的颜色" />
        <input data-category-field="name" type="text" maxlength="12" value="${escapeHtml(category.name)}" aria-label="分类名称" />
        <button data-category-action="up" class="manager-icon-button" type="button" aria-label="上移" ${index === 0 ? "disabled" : ""}>↑</button>
        <button data-category-action="down" class="manager-icon-button" type="button" aria-label="下移" ${index === state.categories.length - 1 ? "disabled" : ""}>↓</button>
        <button data-category-action="delete" class="manager-icon-button danger" type="button" aria-label="删除" ${category.id === "other" ? "disabled" : ""}>×</button>
      </div>
    `).join("");
  }

  function moveCategory(categoryId, direction) {
    const index = state.categories.findIndex((item) => item.id === categoryId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= state.categories.length) return;
    [state.categories[index], state.categories[targetIndex]] = [state.categories[targetIndex], state.categories[index]];
    saveState();
    render();
    renderCategoryManager();
  }

  function deleteCategory(categoryId) {
    const category = state.categories.find((item) => item.id === categoryId);
    if (!category || category.id === "other") return;
    if (!window.confirm(`删除分类「${category.name}」？其中的便签将移到 other。`)) return;
    const fallback = state.categories.find((item) => item.id === "other") || state.categories.find((item) => item.id !== categoryId);
    state.tasks.forEach((task) => {
      if (task.categoryId === categoryId) task.categoryId = fallback?.id || "";
    });
    state.categories = state.categories.filter((item) => item.id !== categoryId);
    if (state.selectedCategoryId === categoryId) state.selectedCategoryId = "all";
    saveState();
    render();
    renderCategoryManager();
    showToast("分类已删除");
  }

  function toDateTimeLocal(value) {
    if (!value) return "";
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function openReminderDialog(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    reminderTaskId = taskId;
    elements.reminderDateInput.value = toDateTimeLocal(task.reminderAt);
    elements.clearReminderButton.hidden = !task.reminderAt;
    elements.reminderDialog.showModal();
    requestAnimationFrame(() => elements.reminderDateInput.focus());
  }

  function saveReminder(value) {
    const task = state.tasks.find((item) => item.id === reminderTaskId);
    if (!task) return;
    task.reminderAt = value ? new Date(value).toISOString() : null;
    task.reminderFiredAt = null;
    saveState();
    render();
    showToast(value ? "提醒已设置" : "提醒已清除");
  }

  function openMenu(taskId, anchor) {
    menuTaskId = taskId;
    elements.menu.hidden = false;
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = elements.menu.getBoundingClientRect();
    const left = Math.min(anchorRect.right - menuRect.width, window.innerWidth - menuRect.width - 8);
    const top = Math.min(anchorRect.bottom + 4, window.innerHeight - menuRect.height - 8);
    elements.menu.style.left = `${Math.max(8, left)}px`;
    elements.menu.style.top = `${Math.max(8, top)}px`;
  }

  function closeMenu() {
    menuTaskId = null;
    elements.menu.hidden = true;
  }

  function openAppMenu(anchor) {
    closeMenu();
    closeSkinPopover();
    elements.appMenu.hidden = false;
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = elements.appMenu.getBoundingClientRect();
    elements.appMenu.style.left = `${Math.max(8, anchorRect.right - menuRect.width)}px`;
    elements.appMenu.style.top = `${anchorRect.bottom + 5}px`;
  }

  function closeAppMenu() {
    elements.appMenu.hidden = true;
  }

  function openSkinPopover() {
    closeMenu();
    closeAppMenu();
    elements.skinPopover.hidden = false;
    elements.themeButton.setAttribute("aria-expanded", "true");
  }

  function closeSkinPopover() {
    elements.skinPopover.hidden = true;
    elements.themeButton.setAttribute("aria-expanded", "false");
  }

  function setSkinColor(color) {
    if (color !== null && !/^#[0-9a-f]{6}$/i.test(color)) return;
    const category = selectedCategory();
    if (color && category) {
      category.color = color;
      state.skinColor = null;
    } else {
      state.skinColor = color;
    }
    saveState();
    render();
    showToast(color ? "皮肤已更换" : "已恢复跟随分类");
  }

  async function hydrateDesktopState() {
    if (!window.desktopAPI) return;
    document.body.classList.add("desktop-app");
    const saved = await window.desktopAPI.loadState();
    if (saved && Array.isArray(saved.categories) && Array.isArray(saved.tasks)) {
      state = migrateState(saved);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
    }
    await window.desktopAPI.saveState(state);
    const pinned = await window.desktopAPI.getPinned();
    elements.pinButton.setAttribute("aria-pressed", String(pinned));
    await refreshAutoLaunch();
    window.desktopAPI.onReminderFired?.((taskId) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) return;
      task.reminderFiredAt = new Date().toISOString();
      saveState();
      render();
      showToast(`提醒：${task.title}`);
    });
    window.desktopAPI.onCreateTask?.(() => openComposer());
  }

  async function refreshAutoLaunch() {
    if (!window.desktopAPI?.getAutoLaunch) return false;
    const enabled = await window.desktopAPI.getAutoLaunch();
    const icon = elements.autoLaunchMenuItem.querySelector("span");
    icon.textContent = enabled ? "✓" : "○";
    elements.autoLaunchMenuItem.setAttribute("aria-pressed", String(enabled));
    return enabled;
  }

  function showToast(message, actionLabel = "", actionHandler = null) {
    clearTimeout(toastTimer);
    elements.toastMessage.textContent = message;
    elements.toastAction.textContent = actionLabel;
    elements.toastAction.hidden = !actionLabel;
    toastActionHandler = actionHandler;
    elements.toast.classList.add("show");
    toastTimer = setTimeout(() => {
      elements.toast.classList.remove("show");
      elements.toastAction.hidden = true;
      toastActionHandler = null;
    }, actionLabel ? 5000 : 1800);
  }

  elements.toastAction.addEventListener("click", () => {
    const handler = toastActionHandler;
    toastActionHandler = null;
    elements.toastAction.hidden = true;
    if (handler) handler();
  });

  elements.searchButton.addEventListener("click", () => {
    if (elements.searchPanel.hidden) openSearch();
    else closeSearch();
  });

  elements.searchPanel.addEventListener("submit", (event) => event.preventDefault());
  elements.searchInput.addEventListener("input", () => {
    searchQuery = elements.searchInput.value.trim();
    render();
  });
  elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSearch();
  });
  elements.closeSearchButton.addEventListener("click", closeSearch);

  elements.minimizeButton.addEventListener("click", () => window.desktopAPI?.minimize());
  elements.closeButton.addEventListener("click", () => {
    if (window.desktopAPI) window.desktopAPI.close();
    else window.close();
  });
  elements.pinButton.addEventListener("click", async () => {
    if (!window.desktopAPI) {
      showToast("桌面版支持窗口置顶");
      return;
    }
    const pinned = await window.desktopAPI.togglePinned();
    elements.pinButton.setAttribute("aria-pressed", String(pinned));
    showToast(pinned ? "窗口已置顶" : "已取消置顶");
  });
  elements.themeButton.addEventListener("click", () => {
    if (elements.skinPopover.hidden) openSkinPopover();
    else closeSkinPopover();
  });
  elements.skinPopover.addEventListener("click", (event) => {
    const swatch = event.target.closest("[data-skin-color]");
    if (swatch) setSkinColor(swatch.dataset.skinColor);
  });
  elements.customColorInput.addEventListener("input", () => setSkinColor(elements.customColorInput.value));
  elements.followCategoryButton.addEventListener("click", () => setSkinColor(null));
  elements.opacityRange.addEventListener("input", () => {
    state.panelOpacity = normalizeOpacity(elements.opacityRange.value);
    const boardColor = state.skinColor || selectedCategory()?.color || "#89b6ef";
    applyAppearance(boardColor);
  });
  elements.opacityRange.addEventListener("change", () => {
    saveState();
    showToast(`透明度已设为 ${state.panelOpacity}%`);
  });
  elements.appMenuButton.addEventListener("click", () => {
    if (elements.appMenu.hidden) openAppMenu(elements.appMenuButton);
    else closeAppMenu();
  });

  elements.appMenu.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-app-action]")?.dataset.appAction;
    closeAppMenu();
    if (action === "new") openComposer();
    if (action === "categories") {
      renderCategoryManager();
      elements.categoryManagerDialog.showModal();
    }
    if (action === "recycle") {
      renderRecycleBin();
      elements.recycleDialog.showModal();
    }
    if (action === "auto-launch") {
      if (!window.desktopAPI?.toggleAutoLaunch) return showToast("桌面版支持开机启动");
      const enabled = await window.desktopAPI.toggleAutoLaunch();
      await refreshAutoLaunch();
      showToast(enabled ? "已开启开机启动" : "已关闭开机启动");
    }
    if (action === "export") {
      if (!window.desktopAPI) return showToast("请在桌面版中导出");
      const result = await window.desktopAPI.exportData(state);
      if (result?.ok) showToast("备份已导出");
    }
    if (action === "import") {
      if (!window.desktopAPI) return showToast("请在桌面版中导入");
      const result = await window.desktopAPI.importData();
      if (result?.ok && result.data) {
        state = migrateState(result.data);
        saveState();
        render();
        showToast("备份已导入");
      } else if (result?.error) {
        showToast(result.error);
      }
    }
    if (action === "reset" && window.confirm("恢复初始内容？当前便签将被替换。")) {
      state = structuredClone(initialState);
      saveState();
      render();
      showToast("已恢复初始内容");
    }
    if (action === "quit") {
      if (window.desktopAPI?.quit) window.desktopAPI.quit();
      else window.close();
    }
  });

  elements.categoryList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category-id]");
    if (button) selectCategory(button.dataset.categoryId);
  });

  elements.allTasksButton.addEventListener("click", () => selectCategory("all"));

  elements.openComposerButton.addEventListener("click", () => {
    if (elements.composer.hidden) openComposer();
    else closeComposer();
  });

  elements.cancelComposerButton.addEventListener("click", closeComposer);
  elements.composer.addEventListener("submit", (event) => {
    event.preventDefault();
    addTask(elements.taskInput.value, elements.newTaskReminderInput.value);
  });
  elements.taskInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.composer.requestSubmit();
    }
    if (event.key === "Escape") closeComposer();
  });

  function handleTaskListClick(event) {
    const item = event.target.closest("[data-task-id]");
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!item || !action) return;
    if (action === "toggle") toggleTask(item.dataset.taskId);
    if (action === "menu") openMenu(item.dataset.taskId, event.target.closest("button"));
  }

  function handleTaskListDoubleClick(event) {
    const title = event.target.closest(".task-title");
    const item = event.target.closest("[data-task-id]");
    if (title && item) startInlineEdit(item.dataset.taskId, title);
  }

  elements.activeTaskList.addEventListener("click", handleTaskListClick);
  elements.completedTaskList.addEventListener("click", handleTaskListClick);
  elements.activeTaskList.addEventListener("dblclick", handleTaskListDoubleClick);
  elements.completedTaskList.addEventListener("dblclick", handleTaskListDoubleClick);

  elements.completedToggle.addEventListener("click", () => {
    state.completedExpanded = !state.completedExpanded;
    saveState();
    render();
  });

  elements.menu.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    const taskId = menuTaskId;
    closeMenu();
    if (!taskId) return;
    if (action === "edit") editTask(taskId);
    if (action === "reminder") openReminderDialog(taskId);
    if (action === "move") moveTask(taskId);
    if (action === "delete") deleteTask(taskId);
  });

  elements.addCategoryButton.addEventListener("click", () => {
    elements.categoryNameInput.value = "";
    elements.categoryDialog.showModal();
    requestAnimationFrame(() => elements.categoryNameInput.focus());
  });

  elements.categoryForm.addEventListener("submit", (event) => {
    const submitterValue = event.submitter?.value;
    if (submitterValue === "cancel") return;
    event.preventDefault();
    const name = elements.categoryNameInput.value.trim();
    if (!name) {
      elements.categoryNameInput.focus();
      return;
    }
    const color = new FormData(elements.categoryForm).get("color") || "#89b6ef";
    const category = { id: uid("category"), name: name.slice(0, 12), color };
    state.categories.push(category);
    state.selectedCategoryId = category.id;
    saveState();
    elements.categoryDialog.close();
    render();
    showToast(`已创建「${category.name}」`);
  });

  elements.reminderForm.addEventListener("submit", (event) => {
    const action = event.submitter?.value;
    if (action === "cancel") {
      reminderTaskId = null;
      return;
    }
    event.preventDefault();
    if (action === "clear") {
      saveReminder("");
      elements.reminderDialog.close();
      reminderTaskId = null;
      return;
    }
    if (!elements.reminderDateInput.value) {
      elements.reminderDateInput.focus();
      return;
    }
    saveReminder(elements.reminderDateInput.value);
    elements.reminderDialog.close();
    reminderTaskId = null;
  });

  elements.closeCategoryManagerButton.addEventListener("click", () => elements.categoryManagerDialog.close());
  elements.categoryManagerList.addEventListener("change", (event) => {
    const row = event.target.closest("[data-managed-category-id]");
    const field = event.target.dataset.categoryField;
    if (!row || !field) return;
    const category = state.categories.find((item) => item.id === row.dataset.managedCategoryId);
    if (!category) return;
    if (field === "name") {
      const name = event.target.value.trim();
      if (!name) {
        event.target.value = category.name;
        return;
      }
      category.name = name.slice(0, 12);
      event.target.value = category.name;
    }
    if (field === "color" && /^#[0-9a-f]{6}$/i.test(event.target.value)) category.color = event.target.value;
    saveState();
    render();
  });
  elements.categoryManagerList.addEventListener("input", (event) => {
    if (event.target.dataset.categoryField !== "color") return;
    const row = event.target.closest("[data-managed-category-id]");
    const category = state.categories.find((item) => item.id === row?.dataset.managedCategoryId);
    if (!category) return;
    category.color = event.target.value;
    saveState();
    render();
  });
  elements.categoryManagerList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category-action]");
    const row = event.target.closest("[data-managed-category-id]");
    if (!button || !row) return;
    const categoryId = row.dataset.managedCategoryId;
    if (button.dataset.categoryAction === "up") moveCategory(categoryId, -1);
    if (button.dataset.categoryAction === "down") moveCategory(categoryId, 1);
    if (button.dataset.categoryAction === "delete") deleteCategory(categoryId);
  });

  elements.closeRecycleButton.addEventListener("click", () => elements.recycleDialog.close());
  elements.recycleList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-recycle-action]");
    const item = event.target.closest("[data-deleted-task-id]");
    if (!button || !item) return;
    if (button.dataset.recycleAction === "restore") restoreDeletedTask(item.dataset.deletedTaskId);
    if (button.dataset.recycleAction === "delete") deleteTaskForever(item.dataset.deletedTaskId);
  });
  elements.emptyRecycleButton.addEventListener("click", () => {
    if (!Array.isArray(state.deletedTasks) || state.deletedTasks.length === 0) return;
    if (!window.confirm("永久清空回收站？此操作无法撤销。")) return;
    state.deletedTasks = [];
    lastDeletedTaskId = null;
    saveState();
    render();
    renderRecycleBin();
    showToast("回收站已清空");
  });

  document.addEventListener("click", (event) => {
    if (!elements.menu.hidden && !elements.menu.contains(event.target) && !event.target.closest("[data-action='menu']")) {
      closeMenu();
    }
    if (!elements.appMenu.hidden && !elements.appMenu.contains(event.target) && !event.target.closest("#appMenuButton")) {
      closeAppMenu();
    }
    if (!elements.skinPopover.hidden && !elements.skinPopover.contains(event.target) && !event.target.closest("#themeButton")) {
      closeSkinPopover();
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openSearch();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      openComposer();
    }
    const typingTarget = event.target.matches?.("input, textarea, [contenteditable='true']");
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && lastDeletedTaskId && !typingTarget) {
      event.preventDefault();
      restoreDeletedTask(lastDeletedTaskId);
    }
    if (event.key === "Escape") {
      closeMenu();
      closeAppMenu();
      closeSkinPopover();
    }
  });

  window.addEventListener("resize", () => {
    closeMenu();
    closeAppMenu();
    closeSkinPopover();
  });
  render();
  hydrateDesktopState().catch((error) => console.warn("载入桌面数据失败", error));
})();

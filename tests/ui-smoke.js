const fs = require("node:fs");

const endpoint = process.env.CDP_ENDPOINT || "http://127.0.0.1:9333";
const screenshotPath = process.env.SCREENSHOT_PATH;

async function findTarget() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
      const target = targets.find((item) => item.type === "page" && item.url.includes("index.html"));
      if (target) return target;
    } catch {
      // Chrome may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("没有找到便签页面的调试目标");
}

async function main() {
  const target = await findTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let commandId = 0;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  function send(method, params = {}) {
    commandId += 1;
    return new Promise((resolve, reject) => {
      pending.set(commandId, { resolve, reject });
      socket.send(JSON.stringify({ id: commandId, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  await send("Runtime.enable");
  await send("Page.enable");

  if (process.env.MIGRATION_ONLY === "1") {
    await evaluate(`(() => {
      localStorage.setItem('local-notes-widget-v1', JSON.stringify({
        selectedCategoryId: 'misc',
        completedExpanded: true,
        skinColor: null,
        transparentMode: true,
        deletedTasks: [],
        categories: [
          { id: 'ccfa', name: 'CCF-A', color: '#f58bb1' },
          { id: 'misc', name: '千！', color: '#89b6ef' },
          { id: 'custom-kept', name: '我的分类', color: '#123456' }
        ],
        tasks: [
          { id: 'custom-task-kept', title: '用户自己新增的便签', categoryId: 'custom-kept', createdAt: '2026-08-29T09:00:00', completedAt: null }
        ]
      }));
      return true;
    })()`);
    await send("Page.reload", { ignoreCache: true });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const migrated = await evaluate(`(() => {
      const state = JSON.parse(localStorage.getItem('local-notes-widget-v1'));
      return {
        dataVersion: state.dataVersion,
        taskCount: state.tasks.length,
        panelOpacity: state.panelOpacity,
        customTaskKept: state.tasks.some((task) => task.id === 'custom-task-kept'),
        customCategoryKept: state.categories.some((category) => category.id === 'custom-kept'),
        miscName: state.categories.find((category) => category.id === 'misc')?.name
      };
    })()`);
    if (migrated.dataVersion !== 3 || migrated.taskCount !== 1 || migrated.panelOpacity !== 55
      || !migrated.customTaskKept || !migrated.customCategoryKept || migrated.miscName !== '千！') {
      throw new Error(`数据迁移测试失败：${JSON.stringify(migrated)}`);
    }
    console.log(JSON.stringify({ passed: true, migration: migrated }));
    await send("Browser.close").catch(() => undefined);
    return;
  }

  if (process.env.WINDOW_ONLY === "1") {
    const { windowId, bounds: originalBounds } = await send("Browser.getWindowForTarget", { targetId: target.id });
    const measureAt = async (width, height) => {
      await send("Browser.setWindowBounds", { windowId, bounds: { width, height } });
      await new Promise((resolve) => setTimeout(resolve, 350));
      return evaluate(`(() => {
        const shell = document.querySelector('.app-shell').getBoundingClientRect();
        return {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          shellWidth: shell.width,
          shellBottom: shell.bottom
        };
      })()`);
    };
    const compact = await measureAt(340, 320);
    const expanded = await measureAt(560, 640);
    await send("Browser.setWindowBounds", { windowId, bounds: originalBounds });
    const fillsWindow = (measurement) => Math.abs(measurement.shellWidth - measurement.innerWidth) < 1
      && Math.abs(measurement.shellBottom - measurement.innerHeight) < 1;
    if (!fillsWindow(compact) || !fillsWindow(expanded) || expanded.innerWidth <= compact.innerWidth || expanded.innerHeight <= compact.innerHeight) {
      throw new Error(`窗口缩放测试失败：${JSON.stringify({ compact, expanded })}`);
    }
    console.log(JSON.stringify({ passed: true, compact, expanded }));
    await evaluate("window.desktopAPI.quit(); true").catch(() => undefined);
    return;
  }

  if (process.env.PIN_ONLY === "1") {
    const pinResult = await evaluate(`(async () => {
      const before = await window.desktopAPI.getPinned();
      const toggled = await window.desktopAPI.togglePinned();
      const verified = await window.desktopAPI.getPinned();
      const restored = await window.desktopAPI.togglePinned();
      return { before, toggled, verified, restored };
    })()`);
    if (pinResult.toggled === pinResult.before || pinResult.verified !== pinResult.toggled || pinResult.restored !== pinResult.before) {
      throw new Error(`置顶状态测试失败：${JSON.stringify(pinResult)}`);
    }
    console.log(JSON.stringify({ passed: true, pin: pinResult }));
    await evaluate("window.desktopAPI.quit(); true").catch(() => undefined);
    return;
  }

  const featureResult = await evaluate(`(() => {
    window.confirm = () => true;
    const readState = () => JSON.parse(localStorage.getItem('local-notes-widget-v1'));
    const blankInstall = localStorage.getItem('local-notes-widget-v1') === null
      && document.querySelectorAll('.task-item').length === 0
      && document.querySelectorAll('.category-tab').length === 9;
    document.querySelector('#allTasksButton').click();
    document.querySelector('#openComposerButton').click();
    document.querySelector('#taskInput').value = '测试本地便签';
    document.querySelector('#composer').requestSubmit();
    const initialData = readState();
    const originalCount = initialData.tasks.length;
    const titleForEdit = document.querySelector('.task-title');
    titleForEdit.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    titleForEdit.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    titleForEdit.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    const inlineEditor = document.querySelector('.inline-edit-input');
    inlineEditor.value = '测试本地便签（已修改）';
    inlineEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const directEditWorked = readState().tasks.some((task) => task.title === '测试本地便签（已修改）');

    const firstMenuButton = document.querySelector('.task-item .task-more');
    firstMenuButton.click();
    document.querySelector('#menu [data-action="delete"]').click();
    const afterDelete = readState();
    document.querySelector('#toastAction').click();
    const afterUndo = readState();

    document.querySelector('#appMenuButton').click();
    document.querySelector('[data-app-action="categories"]').click();
    const managedCategories = document.querySelectorAll('.category-manager-row').length;
    document.querySelector('#closeCategoryManagerButton').click();

    document.querySelector('.task-item .task-more').click();
    document.querySelector('#menu [data-action="reminder"]').click();
    document.querySelector('#reminderDateInput').value = '2030-01-01T09:00';
    document.querySelector('#reminderForm').requestSubmit(document.querySelector('#reminderForm button[value="save"]'));
    const reminderSaved = Boolean(readState().tasks.find((task) => task.reminderAt));

    document.querySelector('.task-item .task-more').click();
    document.querySelector('#menu [data-action="reminder"]').click();
    document.querySelector('#reminderForm').requestSubmit(document.querySelector('#clearReminderButton'));
    const reminderCleared = !readState().tasks.some((task) => task.reminderAt);

    return {
      originalCount,
      afterDeleteCount: afterDelete.tasks.length,
      recycleAfterDelete: afterDelete.deletedTasks.length,
      afterUndoCount: afterUndo.tasks.length,
      recycleAfterUndo: afterUndo.deletedTasks.length,
      managedCategories,
      blankInstall,
      directEditWorked,
      reminderSaved,
      reminderCleared
    };
  })()`);

  const result = await evaluate(`(() => {
    const shellBounds = document.querySelector('.app-shell').getBoundingClientRect();
    const search = document.querySelector('#searchInput');
    document.querySelector('#searchButton').click();
    search.value = '测试';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#themeButton').click();
    document.querySelector('[data-skin-color="#f78eb8"]').click();
    const opacity = document.querySelector('#opacityRange');
    opacity.value = '62';
    opacity.dispatchEvent(new Event('input', { bubbles: true }));
    opacity.dispatchEvent(new Event('change', { bubbles: true }));
    const savedState = JSON.parse(localStorage.getItem('local-notes-widget-v1'));
    const expectedSearchCount = savedState.tasks.filter((task) => task.title.toLocaleLowerCase('zh-CN').includes('测试')).length;
    const opacityWorked = savedState.panelOpacity === 62
      && document.body.classList.contains('transparent-mode')
      && document.querySelector('#opacityValue').textContent === '62%';
    return {
      skinPickerOpen: !document.querySelector('#skinPopover').hidden,
      moreColors: document.querySelectorAll('.skin-swatch[data-skin-color]').length >= 24,
      selectedSkin: savedState.skinColor,
      resultCount: document.querySelectorAll('.task-item').length,
      highlightedMatches: document.querySelectorAll('.task-title mark').length,
      resultLabel: document.querySelector('#searchResultCount').textContent,
      expectedSearchCount,
      opacityWorked,
      shellFillsWindow: Math.abs(shellBounds.width - window.innerWidth) < 1
        && Math.abs(shellBounds.bottom - window.innerHeight) < 1,
      framelessBoard: getComputedStyle(document.querySelector('.note-board')).borderTopWidth === '0px',
      toolbarMerged: document.querySelector('.board-header > .desktop-toolbar') !== null,
      compactType: parseFloat(getComputedStyle(document.querySelector('.task-title')).fontSize) === 15,
      draggableHeader: getComputedStyle(document.querySelector('.board-header')).webkitAppRegion === 'drag',
      clickableToolbar: getComputedStyle(document.querySelector('#searchButton')).webkitAppRegion === 'no-drag'
    };
  })()`);

  const passed = result.skinPickerOpen
    && result.moreColors
    && result.selectedSkin === "#f78eb8"
    && result.resultCount === result.expectedSearchCount
    && result.highlightedMatches === result.expectedSearchCount
    && result.resultLabel === `${result.expectedSearchCount} 条`
    && result.opacityWorked
    && result.shellFillsWindow
    && result.framelessBoard
    && result.toolbarMerged
    && result.compactType
    && result.draggableHeader
    && result.clickableToolbar
    && featureResult.afterDeleteCount === featureResult.originalCount - 1
    && featureResult.recycleAfterDelete === 1
    && featureResult.afterUndoCount === featureResult.originalCount
    && featureResult.recycleAfterUndo === 0
    && featureResult.managedCategories === 9
    && featureResult.blankInstall
    && featureResult.directEditWorked
    && featureResult.reminderSaved
    && featureResult.reminderCleared;

  if (!passed) throw new Error(`界面冒烟测试失败：${JSON.stringify({ result, featureResult })}`);

  if (screenshotPath) {
    const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  }

  console.log(JSON.stringify({ passed: true, ...result, ...featureResult }));
  await send("Browser.close").catch(() => undefined);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

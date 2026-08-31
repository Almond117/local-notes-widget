const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, screen, Tray } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const DATA_FILE = "notes-data.json";
const SETTINGS_FILE = "window-settings.json";
let mainWindow = null;
let tray = null;
let saveBoundsTimer = null;
let isQuitting = false;
const reminderTimers = new Map();

function readJson(fileName, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), fileName), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(fileName, value) {
  const destination = path.join(app.getPath("userData"), fileName);
  const temporary = `${destination}.tmp`;
  const serialized = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > 2 * 1024 * 1024) {
    throw new Error("便签数据超过 2MB，无法保存");
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(temporary, serialized, "utf8");
  fs.copyFileSync(temporary, destination);
  fs.unlinkSync(temporary);
}

function isValidState(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.categories) && Array.isArray(value.tasks));
}

function visibleBounds(saved) {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return {};
  const point = { x: saved.x + 30, y: saved.y + 30 };
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height;
  });
  if (!visible) return {};
  return {
    x: saved.x,
    y: saved.y,
    width: Math.max(320, saved.width || 480),
    height: Math.max(300, saved.height || 760)
  };
}

function saveWindowSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const previous = readJson(SETTINGS_FILE, {});
  writeJson(SETTINGS_FILE, {
    ...previous,
    ...mainWindow.getBounds(),
    pinned: mainWindow.isAlwaysOnTop()
  });
}

function scheduleWindowSettingsSave() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveWindowSettings, 250);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function launchItemOptions(openAtLogin) {
  const portablePath = process.env.PORTABLE_EXECUTABLE_FILE;
  const executablePath = portablePath || process.execPath;
  return {
    openAtLogin,
    path: executablePath,
    args: app.isPackaged || portablePath ? [] : [app.getAppPath()]
  };
}

function isAutoLaunchEnabled() {
  const options = launchItemOptions(false);
  return app.getLoginItemSettings({ path: options.path, args: options.args }).openAtLogin;
}

function setAutoLaunch(enabled) {
  app.setLoginItemSettings(launchItemOptions(enabled));
  return isAutoLaunchEnabled();
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="3" y="2" width="26" height="28" rx="6" fill="#f48db5"/>
      <path d="M9 10h14M9 16h14M9 22h9" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M22 30l7-7v2a5 5 0 0 1-5 5h-2z" fill="#ffd2e2"/>
    </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`).resize({ width: 20, height: 20 });
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: "显示本地便签", click: showMainWindow },
    {
      label: "新增便签",
      click: () => {
        showMainWindow();
        mainWindow?.webContents.send("app:new-task");
      }
    },
    { type: "separator" },
    {
      label: "窗口置顶",
      type: "checkbox",
      checked: Boolean(mainWindow?.isAlwaysOnTop()),
      click: (item) => {
        mainWindow?.setAlwaysOnTop(item.checked, "screen-saver");
        saveWindowSettings();
      }
    },
    {
      label: "开机启动",
      type: "checkbox",
      checked: isAutoLaunchEnabled(),
      click: (item) => setAutoLaunch(item.checked)
    },
    { type: "separator" },
    {
      label: "退出程序",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip("本地便签");
  tray.on("click", showMainWindow);
  tray.on("right-click", () => tray.popUpContextMenu(trayMenu()));
}

function clearReminderTimers() {
  reminderTimers.forEach((timer) => clearTimeout(timer));
  reminderTimers.clear();
}

function fireReminder(task) {
  reminderTimers.delete(task.id);
  if (Notification.isSupported()) {
    const notification = new Notification({ title: "本地便签提醒", body: task.title, silent: false });
    notification.on("click", showMainWindow);
    notification.show();
  }
  mainWindow?.webContents.send("reminder:fired", task.id);
}

function scheduleReminders(state) {
  clearReminderTimers();
  if (!state || !Array.isArray(state.tasks)) return;
  const maxDelay = 2_147_000_000;
  state.tasks.forEach((task) => {
    if (!task.reminderAt || task.reminderFiredAt || task.completedAt) return;
    const dueAt = new Date(task.reminderAt).getTime();
    if (!Number.isFinite(dueAt)) return;
    const delay = Math.max(0, dueAt - Date.now());
    if (delay > maxDelay) {
      reminderTimers.set(task.id, setTimeout(() => scheduleReminders(readJson(DATA_FILE, null)), maxDelay));
    } else {
      reminderTimers.set(task.id, setTimeout(() => fireReminder(task), delay));
    }
  });
}

function createWindow() {
  const settings = readJson(SETTINGS_FILE, {});
  mainWindow = new BrowserWindow({
    width: 480,
    height: 760,
    minWidth: 320,
    minHeight: 300,
    ...visibleBounds(settings),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: true,
    maximizable: false,
    show: false,
    alwaysOnTop: Boolean(settings.pinned),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  if (settings.pinned) mainWindow.setAlwaysOnTop(true, "screen-saver");

  mainWindow.loadFile("index.html");
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("move", scheduleWindowSettingsSave);
  mainWindow.on("resize", scheduleWindowSettingsSave);
  mainWindow.on("close", (event) => {
    saveWindowSettings();
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
}

ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:close", () => mainWindow?.hide());
ipcMain.handle("app:quit", () => {
  isQuitting = true;
  app.quit();
});
ipcMain.handle("window:get-pinned", () => Boolean(mainWindow?.isAlwaysOnTop()));
ipcMain.handle("window:toggle-pinned", () => {
  if (!mainWindow) return false;
  const pinned = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(pinned, "screen-saver");
  saveWindowSettings();
  return pinned;
});
ipcMain.handle("app:get-auto-launch", () => isAutoLaunchEnabled());
ipcMain.handle("app:toggle-auto-launch", () => setAutoLaunch(!isAutoLaunchEnabled()));

ipcMain.handle("store:load", () => {
  const stored = readJson(DATA_FILE, null);
  return isValidState(stored) ? stored : null;
});

ipcMain.handle("store:save", (_event, value) => {
  if (!isValidState(value)) throw new Error("便签数据格式无效");
  writeJson(DATA_FILE, value);
  scheduleReminders(value);
  return true;
});

ipcMain.handle("data:export", async (_event, value) => {
  if (!isValidState(value)) return { ok: false, error: "便签数据格式无效" };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出便签备份",
    defaultPath: `本地便签备份-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON 备份", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePath) return { ok: false };
  fs.writeFileSync(result.filePath, JSON.stringify(value, null, 2), "utf8");
  return { ok: true };
});

ipcMain.handle("data:import", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "导入便签备份",
    properties: ["openFile"],
    filters: [{ name: "JSON 备份", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  try {
    const imported = JSON.parse(fs.readFileSync(result.filePaths[0], "utf8"));
    if (!isValidState(imported)) return { ok: false, error: "所选文件不是有效的便签备份" };
    writeJson(DATA_FILE, imported);
    return { ok: true, data: imported };
  } catch {
    return { ok: false, error: "无法读取这个备份文件" };
  }
});

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
    scheduleReminders(readJson(DATA_FILE, null));
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showMainWindow();
    });
  });
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  isQuitting = true;
  clearReminderTimers();
});

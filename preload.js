const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  quit: () => ipcRenderer.invoke("app:quit"),
  getPinned: () => ipcRenderer.invoke("window:get-pinned"),
  togglePinned: () => ipcRenderer.invoke("window:toggle-pinned"),
  getAutoLaunch: () => ipcRenderer.invoke("app:get-auto-launch"),
  toggleAutoLaunch: () => ipcRenderer.invoke("app:toggle-auto-launch"),
  loadState: () => ipcRenderer.invoke("store:load"),
  saveState: (state) => ipcRenderer.invoke("store:save", state),
  exportData: (state) => ipcRenderer.invoke("data:export", state),
  importData: () => ipcRenderer.invoke("data:import"),
  onReminderFired: (callback) => {
    const listener = (_event, taskId) => callback(taskId);
    ipcRenderer.on("reminder:fired", listener);
    return () => ipcRenderer.removeListener("reminder:fired", listener);
  },
  onCreateTask: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:new-task", listener);
    return () => ipcRenderer.removeListener("app:new-task", listener);
  }
});

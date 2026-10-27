(function (root) {
  "use strict";

  const bar = root.document.getElementById("errorNotice");
  const version = root.document.getElementById("appVersion");

  if (version) version.textContent = "版本 " + (root.APP_VERSION || "未知");

  function showError(message, filename, lineNumber) {
    try {
      if (!bar) return;
      const details = String(message || "未知错误").replace(/\s+/g, " ").slice(0, 240);
      const file = filename ? String(filename).split(/[\\/]/).pop() : "未知文件";
      const line = Number(lineNumber) || 0;
      bar.textContent = "出错了：" + details + " " + file + ":" + line + "（点击关闭）";
      bar.hidden = false;
    } catch (_) {
      // Error reporting must not interrupt the game.
    }
  }

  root.onerror = function (message, filename, lineNumber) {
    showError(message, filename, lineNumber);
    return false;
  };

  root.addEventListener("unhandledrejection", function (event) {
    try {
      const reason = event && event.reason;
      const message = reason && reason.message ? reason.message : String(reason || "Promise rejected");
      let filename = "";
      let lineNumber = 0;
      const stack = reason && reason.stack ? String(reason.stack) : "";
      const location = stack.match(/([^()\s]+):(\d+):\d+/);
      if (location) {
        filename = location[1];
        lineNumber = Number(location[2]);
      }
      showError(message, filename, lineNumber);
    } catch (_) {
      showError("Promise rejected", "未知文件", 0);
    }
  });

  if (bar) {
    bar.addEventListener("click", function () { bar.hidden = true; });
  }
})(window);

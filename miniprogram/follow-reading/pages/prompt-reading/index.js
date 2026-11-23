const { callCloud } = require("../../../utils/cloud");

const sanitizeSegment = (value, fallback, limit = 36) => {
  const text = String(value || "").trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-");
  return text.slice(0, limit) || fallback;
};

const formatSeconds = (value) => {
  const total = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// 看提示朗读：逐句看提示录音，可回放、重录，全部录完后统一提交。
Page({
  data: {
    lessonId: "",
    previewStudentId: "",
    mode: "",
    isTeacherPreview: false,
    state: "loading",
    message: "",
    lesson: null,
    student: null,
    textMode: "reveal",
    responseSeconds: 20,
    planMode: "full",
    roundCount: 0,
    items: [],
    totalCount: 0,
    recordedCount: 0,
    progressPercent: 0,
    currentIndex: 0,
    currentItem: null,
    itemState: "idle",
    itemMessage: "",
    elapsedLabel: "0:00",
    remainingLabel: "0:00",
    playingItemId: "",
    uploadDone: 0,
    uploadTotal: 0,
    submittedAttemptNo: 0,
    submittedScope: "full",
    submittedLate: false,
  },

  onLoad(options) {
    this.setData({
      lessonId: options.lessonId || "",
      previewStudentId: options.previewStudentId || "",
      mode: options.mode || "",
    });
    this.recordings = {};
    this.uploadedByItemId = {};
    if (this.setupRecorder() === false) return;
    this.setupPlayer();
    this.loadPractice();
  },

  onHide() {
    // 录音中切到后台：只作废正在录的这一句，已录好的句子保留。
    if (["starting", "recording", "stopping"].includes(this.data.itemState)) {
      this.discardNextStop = true;
      try { this.recorder.stop(); } catch (_) {}
      this.clearRecordTimer();
      this.setData({ itemState: "idle", itemMessage: "刚才离开了页面，这一句没有保存，请重新录一次。" });
    }
    this.stopPlayback();
  },

  onUnload() {
    this.isUnloading = true;
    this.discardNextStop = true;
    this.clearRecordTimer();
    if (["starting", "recording", "stopping"].includes(this.data.itemState)) {
      try { this.recorder.stop(); } catch (_) {}
    }
    this.teardownRecorder();
    if (this.player) this.player.destroy();
    this.keepScreenOn(false);
    this.enableLeaveWarning(false);
  },

  setupRecorder() {
    if (typeof wx.getRecorderManager !== "function") {
      this.setData({ state: "error", message: "请升级微信后使用录音功能。" });
      return false;
    }
    this.recorder = wx.getRecorderManager();
    this.handleRecorderStart = () => {
      if (this.data.itemState !== "starting") return;
      const limit = this.data.responseSeconds;
      this.recordStartedAt = Date.now();
      this.setData({ itemState: "recording", elapsedLabel: "0:00", remainingLabel: formatSeconds(limit) });
      this.recordTimer = setInterval(() => {
        const elapsed = (Date.now() - this.recordStartedAt) / 1000;
        this.setData({
          elapsedLabel: formatSeconds(elapsed),
          remainingLabel: formatSeconds(Math.max(0, limit - elapsed)),
        });
      }, 500);
    };
    this.handleRecorderStop = (result) => {
      this.clearRecordTimer();
      const itemId = this.recordingItemId;
      this.recordingItemId = "";
      if (this.discardNextStop || this.isUnloading) {
        this.discardNextStop = false;
        return;
      }
      if (!itemId) return;
      if (!result || !result.tempFilePath || Number(result.duration || 0) < 500) {
        this.setData({ itemState: "idle", itemMessage: "没有录到清楚的声音，请靠近手机再读一次。" });
        return;
      }
      this.recordings[itemId] = {
        tempFilePath: result.tempFilePath,
        duration: Number(result.duration || 0),
        fileSize: Number(result.fileSize || 0),
      };
      delete this.uploadedByItemId[itemId];
      this.refreshItems({ itemState: "recorded", itemMessage: "" });
      this.enableLeaveWarning(true);
    };
    this.handleRecorderError = (error) => {
      console.error(error);
      this.clearRecordTimer();
      this.recordingItemId = "";
      if (this.isUnloading) return;
      this.setData({ itemState: "idle", itemMessage: "麦克风没有正常工作，请检查权限后再试一次。" });
    };
    this.recorder.onStart(this.handleRecorderStart);
    this.recorder.onStop(this.handleRecorderStop);
    this.recorder.onError(this.handleRecorderError);
    return true;
  },

  teardownRecorder() {
    if (!this.recorder) return;
    if (typeof this.recorder.offStart === "function") this.recorder.offStart(this.handleRecorderStart);
    if (typeof this.recorder.offStop === "function") this.recorder.offStop(this.handleRecorderStop);
    if (typeof this.recorder.offError === "function") this.recorder.offError(this.handleRecorderError);
  },

  setupPlayer() {
    if (typeof wx.createInnerAudioContext !== "function") return;
    this.player = wx.createInnerAudioContext({ useWebAudioImplement: false });
    this.player.obeyMuteSwitch = false;
    this.player.onEnded(() => this.setData({ playingItemId: "" }));
    this.player.onStop(() => this.setData({ playingItemId: "" }));
    this.player.onError((error) => {
      console.error(error);
      this.setData({ playingItemId: "" });
      wx.showToast({ title: "这一句暂时无法播放，请重录", icon: "none" });
    });
  },

  loadPractice() {
    if (!this.data.lessonId) {
      this.setData({ state: "error", message: "课程信息不完整，请返回课程页重新进入。" });
      return;
    }
    this.setData({ state: "loading", message: "" });
    callCloud({
      type: "getPromptReadingPractice",
      data: {
        lessonId: this.data.lessonId,
        mode: this.data.mode,
        previewStudentId: this.data.previewStudentId,
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "无法读取朗读任务");
      const plan = result.plan || {};
      const task = result.task || {};
      const feedbackById = {};
      (plan.retakeFeedback || []).forEach((entry) => { feedbackById[entry.itemId] = entry.feedback || ""; });
      const retakeIds = plan.mode === "retake" ? plan.retakeItemIds || [] : [];
      const baseItems = (task.items || [])
        .filter((item) => !retakeIds.length || retakeIds.includes(item.id))
        .map((item) => Object.assign({}, item, {
          teacherFeedback: feedbackById[item.id] || "",
          revealed: task.textMode === "show",
        }));
      this.baseItems = baseItems;
      this.recordings = {};
      this.uploadedByItemId = {};
      this.requestId = "";
      this.setData({
        lesson: result.lesson,
        student: result.student,
        isTeacherPreview: result.isTeacherPreview === true,
        textMode: task.textMode || "reveal",
        responseSeconds: Number(task.responseSeconds) || 20,
        planMode: retakeIds.length ? "retake" : "full",
        roundCount: Number(plan.roundCount) || 0,
        state: "intro",
        currentIndex: 0,
      }, () => this.refreshItems());
    }).catch((err) => {
      console.error(err);
      this.setData({ state: "error", message: err.message || "朗读任务暂时无法打开" });
    });
  },

  // 根据本地录音重新计算每句状态、进度和当前卡片。
  refreshItems(extra) {
    const items = (this.baseItems || []).map((item) => {
      const recording = this.recordings[item.id];
      return Object.assign({}, item, {
        recorded: Boolean(recording),
        durationLabel: recording ? formatSeconds(recording.duration / 1000) : "",
      });
    });
    const recordedCount = items.filter((item) => item.recorded).length;
    const currentIndex = Math.min(this.data.currentIndex, Math.max(0, items.length - 1));
    const currentItem = items[currentIndex] || null;
    this.setData(Object.assign({
      items,
      totalCount: items.length,
      recordedCount,
      progressPercent: items.length ? Math.round(recordedCount / items.length * 100) : 0,
      currentIndex,
      currentItem,
      itemState: currentItem && currentItem.recorded ? "recorded" : "idle",
    }, extra || {}));
  },

  startPractice() {
    if (this.data.state !== "intro") return;
    this.ensureMicrophonePermission(() => {
      this.keepScreenOn(true);
      this.setData({ state: "practice", currentIndex: 0, itemMessage: "" }, () => this.refreshItems());
    });
  },

  ensureMicrophonePermission(callback) {
    wx.getSetting({
      success: (setting) => {
        const allowed = setting.authSetting && setting.authSetting["scope.record"];
        if (allowed === true) return callback();
        if (allowed === false) return this.showMicrophoneHelp();
        wx.authorize({
          scope: "scope.record",
          success: callback,
          fail: () => this.showMicrophoneHelp(),
        });
      },
      fail: callback,
    });
  },

  showMicrophoneHelp() {
    wx.showModal({
      title: "需要麦克风权限",
      content: "朗读需要使用麦克风。请在小程序设置中允许使用麦克风。",
      confirmText: "打开设置",
      success: (result) => {
        if (result.confirm && wx.openSetting) wx.openSetting();
      },
    });
  },

  isBusy() {
    return ["starting", "recording", "stopping"].includes(this.data.itemState);
  },

  goToItem(e) {
    if (this.isBusy()) return;
    const index = Number(e.currentTarget.dataset.index);
    if (!this.data.items[index]) return;
    this.stopPlayback();
    this.setData({ currentIndex: index, itemMessage: "" }, () => this.refreshItems());
  },

  goPrevious() {
    if (this.isBusy() || this.data.currentIndex <= 0) return;
    this.stopPlayback();
    this.setData({ currentIndex: this.data.currentIndex - 1, itemMessage: "" }, () => this.refreshItems());
  },

  goNext() {
    if (this.isBusy()) return;
    this.stopPlayback();
    const nextIndex = this.data.items.findIndex((item, index) => index > this.data.currentIndex && !item.recorded);
    if (nextIndex >= 0) {
      this.setData({ currentIndex: nextIndex, itemMessage: "" }, () => this.refreshItems());
      return;
    }
    const firstMissing = this.data.items.findIndex((item) => !item.recorded);
    if (firstMissing >= 0) {
      this.setData({ currentIndex: firstMissing, itemMessage: "" }, () => this.refreshItems());
      return;
    }
    this.openReview();
  },

  revealText() {
    if (this.data.textMode !== "reveal" || !this.data.currentItem) return;
    const id = this.data.currentItem.id;
    this.baseItems = this.baseItems.map((item) => (item.id === id ? Object.assign({}, item, { revealed: true }) : item));
    this.refreshItems({ itemState: this.data.itemState });
  },

  previewImage() {
    const url = this.data.currentItem && this.data.currentItem.imageUrl;
    if (url) wx.previewImage({ urls: [url], current: url });
  },

  startRecording() {
    if (this.isBusy() || !this.data.currentItem || !this.recorder) return;
    this.stopPlayback();
    this.discardNextStop = false;
    this.recordingItemId = this.data.currentItem.id;
    this.setData({ itemState: "starting", itemMessage: "" });
    try {
      this.recorder.start({
        duration: this.data.responseSeconds * 1000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: "mp3",
      });
    } catch (error) {
      this.handleRecorderError(error);
    }
  },

  finishRecording() {
    if (this.data.itemState !== "recording") return;
    this.setData({ itemState: "stopping" });
    try { this.recorder.stop(); } catch (error) { this.handleRecorderError(error); }
  },

  rerecord() {
    if (this.isBusy() || !this.data.currentItem) return;
    this.startRecording();
  },

  playItem(e) {
    const itemId = String(e.currentTarget.dataset.id || (this.data.currentItem && this.data.currentItem.id) || "");
    const recording = this.recordings[itemId];
    if (!recording || !this.player || this.isBusy()) return;
    if (this.data.playingItemId === itemId) {
      this.stopPlayback();
      return;
    }
    this.player.stop();
    this.player.src = recording.tempFilePath;
    this.setData({ playingItemId: itemId });
    this.player.play();
  },

  stopPlayback() {
    if (this.player && this.data.playingItemId) this.player.stop();
    if (this.data.playingItemId) this.setData({ playingItemId: "" });
  },

  openReview() {
    if (this.isBusy()) return;
    this.stopPlayback();
    if (this.data.recordedCount < this.data.totalCount) {
      const firstMissing = this.data.items.findIndex((item) => !item.recorded);
      wx.showToast({ title: `还有 ${this.data.totalCount - this.data.recordedCount} 句没有录`, icon: "none" });
      if (firstMissing >= 0) this.setData({ currentIndex: firstMissing }, () => this.refreshItems());
      return;
    }
    this.setData({ state: "review" });
  },

  backToPractice(e) {
    this.stopPlayback();
    const index = Number(e && e.currentTarget && e.currentTarget.dataset.index);
    this.setData({
      state: "practice",
      currentIndex: Number.isInteger(index) && this.data.items[index] ? index : this.data.currentIndex,
      itemMessage: "",
    }, () => this.refreshItems());
  },

  submitAll() {
    if (this.data.state !== "review" && this.data.state !== "upload_error") return;
    this.stopPlayback();
    if (this.data.isTeacherPreview) {
      this.keepScreenOn(false);
      this.enableLeaveWarning(false);
      this.setData({ state: "success", submittedAttemptNo: 0 });
      return;
    }
    if (!this.requestId) this.requestId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const items = this.data.items;
    this.setData({
      state: "uploading",
      uploadDone: Object.keys(this.uploadedByItemId).length,
      uploadTotal: items.length,
    });
    const uploadNext = (index) => {
      if (index >= items.length) return Promise.resolve();
      const item = items[index];
      if (this.uploadedByItemId[item.id]) return uploadNext(index + 1);
      const recording = this.recordings[item.id];
      if (!recording) return Promise.reject(new Error(`第 ${item.order} 句还没有录音`));
      const cloudPath = this.buildCloudPath(item);
      return wx.cloud.uploadFile({ cloudPath, filePath: recording.tempFilePath }).then((upload) => {
        this.uploadedByItemId[item.id] = {
          itemId: item.id,
          fileID: upload.fileID,
          cloudPath,
          fileName: `${String(item.order).padStart(2, "0")}-${item.id}.mp3`,
          duration: recording.duration,
          fileSize: recording.fileSize,
        };
        this.setData({ uploadDone: Object.keys(this.uploadedByItemId).length });
        return uploadNext(index + 1);
      });
    };
    uploadNext(0).then(() => callCloud({
      type: "submitPromptReadingBatch",
      data: {
        lessonId: this.data.lessonId,
        requestId: this.requestId,
        responses: items.map((item) => this.uploadedByItemId[item.id]),
      },
    })).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "朗读录音提交失败");
      this.keepScreenOn(false);
      this.enableLeaveWarning(false);
      this.setData({
        state: "success",
        submittedAttemptNo: result.attemptNo || this.data.roundCount + 1,
        submittedScope: result.scope || this.data.planMode,
        submittedLate: result.submittedLate === true,
      });
    }).catch((error) => {
      console.error(error);
      this.setData({ state: "upload_error", message: error.message || "朗读录音提交失败" });
    });
  },

  buildCloudPath(item) {
    const studentId = sanitizeSegment(this.data.student && this.data.student._id, "student", 30);
    const lessonId = sanitizeSegment(this.data.lessonId, "lesson", 35);
    const requestId = sanitizeSegment(this.requestId, "attempt", 45);
    const itemId = sanitizeSegment(item.id, `item-${item.order}`, 35);
    return `prompt-reading-submissions/${studentId}/${lessonId}/${requestId}/${String(item.order).padStart(2, "0")}-${itemId}.mp3`;
  },

  clearRecordTimer() {
    if (this.recordTimer) clearInterval(this.recordTimer);
    this.recordTimer = null;
  },

  keepScreenOn(value) {
    if (wx.setKeepScreenOn) wx.setKeepScreenOn({ keepScreenOn: value, fail: () => {} });
  },

  enableLeaveWarning(enabled) {
    if (enabled && wx.enableAlertBeforeUnload) {
      wx.enableAlertBeforeUnload({ message: "已录的句子还没有提交，离开后需要重新录。" });
    } else if (!enabled && wx.disableAlertBeforeUnload) {
      wx.disableAlertBeforeUnload();
    }
  },

  goBack() {
    wx.navigateBack();
  },
});

const { KET_SPEAKING_TASKS } = require("../../utils/ketSpeakingTasks");
const { KET_MOCK_SETS } = require("../../utils/ketMockSets");
const {
  FOLLOW_READING_GAP_OPTIONS,
  FOLLOW_READING_MODE_OPTIONS,
  FOLLOW_READING_RESPONSE_OPTIONS,
  HOMEWORK_DUE_OPTIONS,
  PROMPT_READING_MAX_ITEMS,
  PROMPT_READING_RESPONSE_OPTIONS,
  PROMPT_READING_TEXT_MODE_OPTIONS,
  RECORDING_PREPARATION_OPTIONS,
  RECORDING_REPEAT_OPTIONS,
  createPromptReadingItem,
  getRecordingTaskTypeOptions,
  parsePromptReadingLines,
} = require("../../utils/lessonTaskOptions");
const { uploadPromptReadingImage } = require("../../utils/promptReadingImage");

const indexOrZero = (index) => Math.max(0, index);

// 新建课程与编辑课程共用的“课后整理 + 课后任务 + 录音设置”表单。
// 组件只根据 form 推导选择器下标，所有修改通过 change 事件交给页面写回自己的表单。
Component({
  properties: {
    form: {
      type: Object,
      value: {},
    },
    mode: {
      type: String,
      value: "create",
    },
    recordingPlaceholder: {
      type: String,
      value: "",
    },
    ketWeeklyHint: {
      type: String,
      value: "",
    },
  },

  data: {
    homeworkDueOptions: HOMEWORK_DUE_OPTIONS,
    ketSpeakingTasks: KET_SPEAKING_TASKS,
    ketMockSets: KET_MOCK_SETS,
    followReadingModeOptions: FOLLOW_READING_MODE_OPTIONS,
    followReadingGapOptions: FOLLOW_READING_GAP_OPTIONS,
    followReadingResponseOptions: FOLLOW_READING_RESPONSE_OPTIONS,
    recordingRepeatOptions: RECORDING_REPEAT_OPTIONS,
    recordingPreparationOptions: RECORDING_PREPARATION_OPTIONS,
    recordingTaskTypeOptions: getRecordingTaskTypeOptions(""),
    recordingTaskTypeIndex: 0,
    homeworkDueIndex: 0,
    ketSpeakingTaskIndex: 0,
    selectedKetSpeakingTask: KET_SPEAKING_TASKS[0],
    ketMockSetIndex: 0,
    selectedKetMockSet: KET_MOCK_SETS[0],
    followReadingModeIndex: 0,
    followReadingGapIndex: 0,
    followReadingResponseIndex: 0,
    recordingRepeatIndex: 0,
    recordingPreparationIndex: 0,
    promptTextModeOptions: PROMPT_READING_TEXT_MODE_OPTIONS,
    promptResponseOptions: PROMPT_READING_RESPONSE_OPTIONS,
    promptMaxItems: PROMPT_READING_MAX_ITEMS,
    promptTextModeIndex: 0,
    promptResponseIndex: 2,
    showPromptBulkPaste: false,
    promptBulkText: "",
    uploadingPromptKey: "",
  },

  observers: {
    form(form) {
      const source = form || {};
      const recordingTaskTypeOptions = getRecordingTaskTypeOptions(source.lessonTemplateKey);
      const ketSpeakingTaskIndex = indexOrZero(KET_SPEAKING_TASKS.findIndex((item) => item.id === source.ketSpeakingTaskId));
      const ketMockSetIndex = indexOrZero(KET_MOCK_SETS.findIndex((item) => item.id === source.ketMockSetId));
      this.setData({
        recordingTaskTypeOptions,
        recordingTaskTypeIndex: indexOrZero(recordingTaskTypeOptions.findIndex((item) => item.value === source.recordingTaskType)),
        homeworkDueIndex: indexOrZero(HOMEWORK_DUE_OPTIONS.findIndex((item) => item.value === Number(source.homeworkDueDays))),
        ketSpeakingTaskIndex,
        selectedKetSpeakingTask: KET_SPEAKING_TASKS[ketSpeakingTaskIndex],
        ketMockSetIndex,
        selectedKetMockSet: KET_MOCK_SETS[ketMockSetIndex],
        followReadingModeIndex: indexOrZero(FOLLOW_READING_MODE_OPTIONS.findIndex((item) => item.value === source.followReadingMode)),
        followReadingGapIndex: indexOrZero(FOLLOW_READING_GAP_OPTIONS.indexOf(Number(source.followReadingGapSeconds))),
        followReadingResponseIndex: indexOrZero(FOLLOW_READING_RESPONSE_OPTIONS.indexOf(Number(source.followReadingResponseSeconds))),
        recordingRepeatIndex: indexOrZero(RECORDING_REPEAT_OPTIONS.indexOf(Number(source.recordingRepeatCount))),
        recordingPreparationIndex: indexOrZero(RECORDING_PREPARATION_OPTIONS.indexOf(Number(source.recordingPreparationSeconds))),
        promptTextModeIndex: indexOrZero(PROMPT_READING_TEXT_MODE_OPTIONS.findIndex((item) => item.value === source.promptReadingTextMode)),
        promptResponseIndex: Math.max(0, PROMPT_READING_RESPONSE_OPTIONS.indexOf(Number(source.promptReadingResponseSeconds))),
      });
    },
  },

  methods: {
    emit(updates, checkKet) {
      this.triggerEvent("change", { updates, checkKet: checkKet === true });
    },

    onInput(e) {
      this.emit({ [e.currentTarget.dataset.field]: e.detail.value });
    },

    onRecordingTaskChange(e) {
      const enabled = Boolean(e.detail.value);
      const updates = { recordingTaskEnabled: enabled };
      if (enabled && Number(this.data.form.homeworkDueDays) < 0) updates.homeworkDueDays = 7;
      this.emit(updates);
    },

    onHomeworkDueChange(e) {
      const option = HOMEWORK_DUE_OPTIONS[Number(e.detail.value)] || HOMEWORK_DUE_OPTIONS[0];
      this.emit({ homeworkDueDays: option.value });
    },

    onRecordingTaskTypeChange(e) {
      const options = this.data.recordingTaskTypeOptions;
      const option = options[Number(e.detail.value)] || options[0];
      if (option.value === "ket_official") {
        this.emit(Object.assign({ recordingTaskType: option.value }, this.buildKetSpeakingTaskUpdates(this.data.ketSpeakingTaskIndex)), true);
      } else if (option.value === "ket_mock") {
        this.emit(Object.assign({ recordingTaskType: option.value }, this.buildKetMockSetUpdates(this.data.ketMockSetIndex)), true);
      } else {
        const updates = { recordingTaskType: option.value, ketSpeakingTaskId: "", ketMockSetId: "" };
        // 第一次切到看提示朗读时给一张空白句子卡，老师可以直接填写。
        if (option.value === "prompt_reading" && !this.getPromptItems().length) {
          updates.promptReadingItems = [createPromptReadingItem()];
        }
        this.emit(updates, true);
      }
    },

    onKetSpeakingTaskChange(e) {
      this.emit(this.buildKetSpeakingTaskUpdates(Number(e.detail.value)), true);
    },

    buildKetSpeakingTaskUpdates(index) {
      const task = KET_SPEAKING_TASKS[Math.max(0, Math.min(KET_SPEAKING_TASKS.length - 1, Number(index) || 0))];
      return {
        ketSpeakingTaskId: task.id,
        ketMockSetId: "",
        recordingPrompt: task.prompt,
        recordingRepeatCount: 1,
        recordingPreparationSeconds: task.preparationSeconds,
        ketSkill: `${task.part} · ${task.topic}`,
      };
    },

    onKetMockSetChange(e) {
      this.emit(this.buildKetMockSetUpdates(Number(e.detail.value)), true);
    },

    buildKetMockSetUpdates(index) {
      const set = KET_MOCK_SETS[Math.max(0, Math.min(KET_MOCK_SETS.length - 1, Number(index) || 0))];
      return {
        ketSpeakingTaskId: "",
        ketMockSetId: set.id,
        recordingPrompt: `${set.title}：按完整考试流程完成 Part 1 与 Part 2。`,
        recordingRepeatCount: 1,
        recordingPreparationSeconds: 0,
        ketSkill: `Speaking Part 1 + Part 2 · ${set.topic}`,
      };
    },

    copyKetSource() {
      const task = this.data.selectedKetSpeakingTask;
      if (task && task.sourceUrl) wx.setClipboardData({ data: task.sourceUrl });
    },

    onRecordingRepeatChange(e) {
      this.emit({ recordingRepeatCount: RECORDING_REPEAT_OPTIONS[Number(e.detail.value)] });
    },

    onRecordingPreparationChange(e) {
      this.emit({ recordingPreparationSeconds: RECORDING_PREPARATION_OPTIONS[Number(e.detail.value)] });
    },

    onFollowReadingModeChange(e) {
      const option = FOLLOW_READING_MODE_OPTIONS[Number(e.detail.value)] || FOLLOW_READING_MODE_OPTIONS[0];
      this.emit({ followReadingMode: option.value });
    },

    onFollowReadingGapChange(e) {
      this.emit({ followReadingGapSeconds: FOLLOW_READING_GAP_OPTIONS[Number(e.detail.value)] });
    },

    onFollowReadingResponseChange(e) {
      this.emit({ followReadingResponseSeconds: FOLLOW_READING_RESPONSE_OPTIONS[Number(e.detail.value)] });
    },

    getPromptItems() {
      const items = this.data.form && this.data.form.promptReadingItems;
      return Array.isArray(items) ? items : [];
    },

    onPromptTextModeChange(e) {
      const option = PROMPT_READING_TEXT_MODE_OPTIONS[Number(e.detail.value)] || PROMPT_READING_TEXT_MODE_OPTIONS[0];
      this.emit({ promptReadingTextMode: option.value });
    },

    onPromptResponseChange(e) {
      this.emit({ promptReadingResponseSeconds: PROMPT_READING_RESPONSE_OPTIONS[Number(e.detail.value)] });
    },

    onPromptItemInput(e) {
      const index = Number(e.currentTarget.dataset.index);
      const field = e.currentTarget.dataset.field === "hint" ? "hint" : "text";
      if (!this.getPromptItems()[index]) return;
      this.emit({ [`promptReadingItems[${index}].${field}`]: e.detail.value });
    },

    addPromptItem() {
      const items = this.getPromptItems();
      if (items.length >= PROMPT_READING_MAX_ITEMS) {
        wx.showToast({ title: `最多 ${PROMPT_READING_MAX_ITEMS} 句`, icon: "none" });
        return;
      }
      this.emit({ promptReadingItems: items.concat(createPromptReadingItem()) });
    },

    removePromptItem(e) {
      const index = Number(e.currentTarget.dataset.index);
      const items = this.getPromptItems().slice();
      if (!items[index]) return;
      items.splice(index, 1);
      this.emit({ promptReadingItems: items });
    },

    movePromptItem(e) {
      const index = Number(e.currentTarget.dataset.index);
      const target = index + (e.currentTarget.dataset.direction === "up" ? -1 : 1);
      const items = this.getPromptItems().slice();
      if (!items[index] || !items[target]) return;
      const moved = items[index];
      items[index] = items[target];
      items[target] = moved;
      this.emit({ promptReadingItems: items });
    },

    togglePromptBulkPaste() {
      this.setData({ showPromptBulkPaste: !this.data.showPromptBulkPaste });
    },

    onPromptBulkInput(e) {
      this.setData({ promptBulkText: e.detail.value });
    },

    applyPromptBulkPaste() {
      const parsed = parsePromptReadingLines(this.data.promptBulkText);
      if (!parsed.length) {
        wx.showToast({ title: "每行写一句，提示放在 | 后面", icon: "none" });
        return;
      }
      // 只有空白卡片时直接替换，否则接在已有句子后面。
      const existing = this.getPromptItems().filter((item) => String(item.text || "").trim() || item.imageFileId);
      const room = PROMPT_READING_MAX_ITEMS - existing.length;
      if (room <= 0) {
        wx.showToast({ title: `已经有 ${PROMPT_READING_MAX_ITEMS} 句`, icon: "none" });
        return;
      }
      const added = parsed.slice(0, room).map((item) => createPromptReadingItem(item));
      this.emit({ promptReadingItems: existing.concat(added) });
      this.setData({ showPromptBulkPaste: false, promptBulkText: "" });
      wx.showToast({
        title: parsed.length > room ? `已加入 ${added.length} 句，超出部分未加入` : `已加入 ${added.length} 句`,
        icon: "none",
      });
    },

    choosePromptImage(e) {
      const index = Number(e.currentTarget.dataset.index);
      const item = this.getPromptItems()[index];
      if (!item || this.data.uploadingPromptKey) return;
      this.setData({ uploadingPromptKey: item.key || String(index) });
      uploadPromptReadingImage().then((image) => {
        if (!image) return;
        const current = this.getPromptItems();
        const currentIndex = current.findIndex((candidate) => candidate === item || (item.key && candidate.key === item.key));
        if (currentIndex < 0) return;
        this.emit({
          [`promptReadingItems[${currentIndex}].imageFileId`]: image.fileID,
          [`promptReadingItems[${currentIndex}].imageCloudPath`]: image.cloudPath,
          [`promptReadingItems[${currentIndex}].imageUrl`]: image.localPath,
        });
      }).catch((error) => {
        console.error(error);
        wx.showToast({ title: "图片上传失败，请重试", icon: "none" });
      }).finally(() => {
        this.setData({ uploadingPromptKey: "" });
      });
    },

    removePromptImage(e) {
      const index = Number(e.currentTarget.dataset.index);
      if (!this.getPromptItems()[index]) return;
      this.emit({
        [`promptReadingItems[${index}].imageFileId`]: "",
        [`promptReadingItems[${index}].imageCloudPath`]: "",
        [`promptReadingItems[${index}].imageUrl`]: "",
      });
    },

    previewPromptImage(e) {
      const url = String(e.currentTarget.dataset.url || "");
      if (url) wx.previewImage({ urls: [url], current: url });
    },
  },
});

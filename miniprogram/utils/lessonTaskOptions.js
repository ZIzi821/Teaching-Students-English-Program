const BASIC_RECORDING_TASK_TYPE_OPTIONS = [
  { value: "manual", label: "独立朗读（学生直接开始）" },
  { value: "follow_reading", label: "跟读（先听老师示范）" },
  { value: "prompt_reading", label: "看提示朗读（逐句提示）" },
];
const KET_RECORDING_TASK_TYPE_OPTIONS = [
  ...BASIC_RECORDING_TASK_TYPE_OPTIONS,
  { value: "ket_official", label: "KET 官方样题" },
  { value: "ket_mock", label: "KET 全流程模拟" },
];
const FOLLOW_READING_MODE_OPTIONS = [
  { value: "automatic", label: "自动连续跟读" },
  { value: "manual", label: "手动逐条播放" },
];
const HOMEWORK_DUE_OPTIONS = [
  { value: -1, label: "以后设置" },
  { value: 0, label: "当天截止" },
  { value: 1, label: "1 天后截止" },
  { value: 2, label: "2 天后截止" },
  { value: 3, label: "3 天后截止" },
  { value: 4, label: "4 天后截止" },
  { value: 5, label: "5 天后截止" },
  { value: 6, label: "6 天后截止" },
  { value: 7, label: "7 天后截止" },
];
const PROMPT_READING_TEXT_MODE_OPTIONS = [
  { value: "reveal", label: "先看提示，可点开原句" },
  { value: "show", label: "一直显示原句" },
  { value: "hide", label: "只看提示" },
];
const PROMPT_READING_RESPONSE_OPTIONS = [10, 15, 20, 30, 45, 60];
const PROMPT_READING_MAX_ITEMS = 20;
const RECORDING_REPEAT_OPTIONS = [1, 2, 3, 4, 5];
const RECORDING_PREPARATION_OPTIONS = [0, 3, 5, 10, 15];
const FOLLOW_READING_GAP_OPTIONS = [1, 2, 3];
const FOLLOW_READING_RESPONSE_OPTIONS = [3, 5, 8, 10, 15, 20];

const getRecordingTaskTypeOptions = (templateKey) => (
  templateKey === "molly_oral_ket" ? KET_RECORDING_TASK_TYPE_OPTIONS : BASIC_RECORDING_TASK_TYPE_OPTIONS
);

// 模板切换后，录音任务类型若不在新模板的可选范围内，回到独立朗读。
const getSafeRecordingTaskType = (templateKey, currentType) => (
  getRecordingTaskTypeOptions(templateKey).some((item) => item.value === currentType) ? currentType : "manual"
);

let promptItemSeed = 0;
const createPromptReadingItem = (source = {}) => {
  promptItemSeed += 1;
  return {
    key: `p${Date.now().toString(36)}${promptItemSeed}`,
    text: String(source.text || ""),
    hint: String(source.hint || ""),
    imageFileId: String(source.imageFileId || ""),
    imageCloudPath: String(source.imageCloudPath || ""),
    imageUrl: String(source.imageUrl || ""),
  };
};

// 批量粘贴：每行一句，句子和提示用竖线分隔，例如 “My name is Jiawen. | 名字”。
const parsePromptReadingLines = (value) => String(value || "")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const index = line.search(/[|｜]/);
    if (index < 0) return { text: line, hint: "" };
    return { text: line.slice(0, index).trim(), hint: line.slice(index + 1).trim() };
  })
  .filter((item) => item.text);

// 提交前只保留有句子的条目，并去掉仅用于界面的字段。
const toPromptReadingPayload = (items) => (Array.isArray(items) ? items : [])
  .filter((item) => String(item && item.text || "").trim())
  .map((item) => ({
    text: String(item.text).trim(),
    hint: String(item.hint || "").trim(),
    imageFileId: item.imageFileId || "",
    imageCloudPath: item.imageCloudPath || "",
  }));

// 返回需要老师处理的问题；没有问题时返回空字符串。
const getPromptReadingFormError = (items) => {
  const list = Array.isArray(items) ? items : [];
  const missingIndex = list.findIndex((item) => !String(item && item.text || "").trim()
    && (String(item && item.hint || "").trim() || (item && item.imageFileId)));
  if (missingIndex >= 0) return `请填写第 ${missingIndex + 1} 句要读的句子`;
  const count = list.filter((item) => String(item && item.text || "").trim()).length;
  if (!count) return "请至少填写 1 句要读的句子";
  if (count > PROMPT_READING_MAX_ITEMS) return `朗读句子最多 ${PROMPT_READING_MAX_ITEMS} 句`;
  return "";
};

module.exports = {
  PROMPT_READING_MAX_ITEMS,
  getPromptReadingFormError,
  PROMPT_READING_RESPONSE_OPTIONS,
  PROMPT_READING_TEXT_MODE_OPTIONS,
  createPromptReadingItem,
  parsePromptReadingLines,
  toPromptReadingPayload,
  FOLLOW_READING_GAP_OPTIONS,
  FOLLOW_READING_MODE_OPTIONS,
  FOLLOW_READING_RESPONSE_OPTIONS,
  HOMEWORK_DUE_OPTIONS,
  RECORDING_PREPARATION_OPTIONS,
  RECORDING_REPEAT_OPTIONS,
  getRecordingTaskTypeOptions,
  getSafeRecordingTaskType,
};

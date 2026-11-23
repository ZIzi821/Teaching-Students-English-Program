const crypto = require("crypto");

// “看提示朗读”：老师逐句布置句子、提示和可选图片，学生逐句录音、回放、重录后统一提交。
const MAX_ITEMS = 20;
const MAX_ITEM_TEXT = 300;
const MAX_HINT_TEXT = 200;
const TEXT_MODES = ["show", "reveal", "hide"];
const DEFAULT_TEXT_MODE = "reveal";
const RESPONSE_SECONDS = [10, 15, 20, 30, 45, 60];
const DEFAULT_RESPONSE_SECONDS = 20;
const IMAGE_PATH_PREFIX = "prompt-reading-images/";
const SUBMISSION_PATH_PREFIX = "prompt-reading-submissions/";
const RETAKE_STATUS = "需要重录";

const asText = (value, limit) => String(value || "").trim().slice(0, limit);

const textHash = (text) => crypto
  .createHash("sha1")
  .update(asText(text, MAX_ITEM_TEXT))
  .digest("hex");

const itemIdFor = (text, duplicateIndex) => `prompt_${crypto
  .createHash("sha1")
  .update(`${asText(text, MAX_ITEM_TEXT)}\n${Math.max(1, Number(duplicateIndex) || 1)}`)
  .digest("hex")
  .slice(0, 16)}`;

// 只接受上传到 prompt-reading-images/ 的云文件；fileID 必须以同一路径结尾，防止引用其他目录的文件。
const normalizeImage = (item = {}) => {
  const fileID = asText(item.imageFileId, 500);
  const cloudPath = asText(item.imageCloudPath, 300);
  if (!fileID || !cloudPath.startsWith(IMAGE_PATH_PREFIX) || cloudPath.includes("..")) {
    return { imageFileId: "", imageCloudPath: "" };
  }
  if (!fileID.startsWith("cloud://") || !fileID.endsWith(`/${cloudPath}`)) {
    return { imageFileId: "", imageCloudPath: "" };
  }
  return { imageFileId: fileID, imageCloudPath: cloudPath };
};

const normalizeItems = (data = {}) => {
  const source = Array.isArray(data.promptReadingItems) ? data.promptReadingItems : [];
  const duplicateCount = new Map();
  return source
    .map((item) => Object.assign({
      text: asText(item && item.text, MAX_ITEM_TEXT),
      hint: asText(item && item.hint, MAX_HINT_TEXT),
    }, normalizeImage(item || {})))
    .filter((item) => item.text)
    .slice(0, MAX_ITEMS)
    .map((item, index) => {
      const duplicateIndex = (duplicateCount.get(item.text) || 0) + 1;
      duplicateCount.set(item.text, duplicateIndex);
      return {
        id: itemIdFor(item.text, duplicateIndex),
        order: index + 1,
        text: item.text,
        textHash: textHash(item.text),
        hint: item.hint,
        imageFileId: item.imageFileId,
        imageCloudPath: item.imageCloudPath,
      };
    });
};

const normalizeTextMode = (value) => (TEXT_MODES.includes(value) ? value : DEFAULT_TEXT_MODE);

const normalizeResponseSeconds = (value) => {
  const seconds = Math.trunc(Number(value));
  return RESPONSE_SECONDS.includes(seconds) ? seconds : DEFAULT_RESPONSE_SECONDS;
};

const normalizeTask = (data = {}) => ({
  promptReadingTextMode: normalizeTextMode(data.promptReadingTextMode),
  promptReadingResponseSeconds: normalizeResponseSeconds(data.promptReadingResponseSeconds),
  promptReadingItems: normalizeItems(data),
});

// 任务签名只包含句子和原句显示方式；修改提示或图片不会重置学生的完成状态。
const getSignatureFields = (lesson = {}) => {
  if (lesson.recordingTaskType !== "prompt_reading") return null;
  const task = normalizeTask(lesson);
  return {
    textMode: task.promptReadingTextMode,
    items: task.promptReadingItems.map((item) => ({ id: item.id, text: item.text })),
  };
};

const collectImageFileIds = (items) => Array.from(new Set((items || [])
  .map((item) => item && item.imageFileId)
  .filter(Boolean)));

const buildImageUrlMap = (fileList) => {
  const urlByFileID = new Map();
  (fileList || []).forEach((file) => {
    if (file && file.status === 0 && file.fileID && file.tempFileURL) {
      urlByFileID.set(String(file.fileID), String(file.tempFileURL));
    }
  });
  return urlByFileID;
};

// 学生端只拿到临时图片地址；“只看提示”时不下发原句。
const sanitizeItemsForViewer = (items, urlByFileID, textMode, isTeacher) => (items || []).map((item) => {
  const result = {
    id: item.id,
    order: item.order,
    hint: item.hint || "",
    imageUrl: item.imageFileId ? (urlByFileID.get(String(item.imageFileId)) || "") : "",
    hasImage: Boolean(item.imageFileId),
  };
  if (isTeacher || textMode !== "hide") result.text = item.text;
  return result;
});

const getSubmissionTime = (item) => Number(item && item.createdAtMs) || 0;

// 计算本次应录哪些句子：没有完整一轮时整轮录；已有完整一轮且老师标了“需要重录”时只补录这些句子。
const buildRetakePlan = (items, submissions) => {
  const latestByItemId = new Map();
  (submissions || []).forEach((submission) => {
    const itemId = String(submission && submission.promptReadingItemId || "");
    if (!itemId) return;
    const current = latestByItemId.get(itemId);
    if (!current || getSubmissionTime(submission) >= getSubmissionTime(current)) {
      latestByItemId.set(itemId, submission);
    }
  });
  const safeItems = items || [];
  const hasFullRound = safeItems.length > 0 && safeItems.every((item) => latestByItemId.has(item.id));
  const retakeItems = hasFullRound
    ? safeItems.filter((item) => latestByItemId.get(item.id).status === RETAKE_STATUS)
    : [];
  const roundCount = new Set((submissions || []).map((item) => item && item.batchId).filter(Boolean)).size;
  return {
    hasFullRound,
    roundCount,
    retakeItemIds: retakeItems.map((item) => item.id),
    retakeFeedback: retakeItems.map((item) => {
      const latest = latestByItemId.get(item.id);
      return { itemId: item.id, feedback: String(latest.teacherFeedback || "").slice(0, 500) };
    }),
    mode: retakeItems.length ? "retake" : "full",
  };
};

// 提交的句子集合必须是“全部句子”或“恰好是需要重录的句子”。
const resolveSubmissionScope = (items, responseItemIds, plan) => {
  const submitted = new Set(responseItemIds || []);
  if (submitted.size !== (responseItemIds || []).length) return "";
  const allIds = (items || []).map((item) => item.id);
  const sameSet = (ids) => ids.length === submitted.size && ids.every((id) => submitted.has(id));
  if (allIds.length && sameSet(allIds)) return "full";
  if (plan && plan.hasFullRound && plan.retakeItemIds.length && sameSet(plan.retakeItemIds)) return "retake";
  return "";
};

const isValidSubmissionPath = (cloudPath) => (
  String(cloudPath || "").startsWith(SUBMISSION_PATH_PREFIX) && !String(cloudPath).includes("..")
);

module.exports = {
  DEFAULT_RESPONSE_SECONDS,
  DEFAULT_TEXT_MODE,
  IMAGE_PATH_PREFIX,
  MAX_HINT_TEXT,
  MAX_ITEMS,
  MAX_ITEM_TEXT,
  RESPONSE_SECONDS,
  SUBMISSION_PATH_PREFIX,
  TEXT_MODES,
  buildImageUrlMap,
  buildRetakePlan,
  collectImageFileIds,
  getSignatureFields,
  isValidSubmissionPath,
  normalizeItems,
  normalizeTask,
  resolveSubmissionScope,
  sanitizeItemsForViewer,
  textHash,
};

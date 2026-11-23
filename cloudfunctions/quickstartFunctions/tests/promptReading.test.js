const assert = require("assert");
const promptReading = require("../promptReading");

const image = {
  imageFileId: "cloud://env-test.bucket/prompt-reading-images/teacher/2026-11/a.jpg",
  imageCloudPath: "prompt-reading-images/teacher/2026-11/a.jpg",
};

const task = promptReading.normalizeTask({
  promptReadingTextMode: "hide",
  promptReadingResponseSeconds: 30,
  promptReadingItems: [
    Object.assign({ text: "My name is Jiawen.", hint: "名字" }, image),
    { text: "  ", hint: "空句子会被忽略" },
    { text: "I am nine years old.", hint: "年龄" },
    { text: "My name is Jiawen.", hint: "重复句子" },
  ],
});

assert.strictEqual(task.promptReadingTextMode, "hide");
assert.strictEqual(task.promptReadingResponseSeconds, 30);
assert.strictEqual(task.promptReadingItems.length, 3, "empty sentences are dropped");
assert.deepStrictEqual(task.promptReadingItems.map((item) => item.order), [1, 2, 3]);
assert.notStrictEqual(task.promptReadingItems[0].id, task.promptReadingItems[2].id, "duplicate sentences need unique ids");
assert.strictEqual(task.promptReadingItems[0].imageFileId, image.imageFileId);

const defaults = promptReading.normalizeTask({ promptReadingTextMode: "other", promptReadingResponseSeconds: 7 });
assert.strictEqual(defaults.promptReadingTextMode, "reveal");
assert.strictEqual(defaults.promptReadingResponseSeconds, 20);
assert.deepStrictEqual(defaults.promptReadingItems, []);

// 只接受 prompt-reading-images/ 目录且 fileID 与路径一致的图片。
const rejectedImages = promptReading.normalizeItems({
  promptReadingItems: [
    { text: "a", imageFileId: "cloud://env.bucket/lesson-materials/x.jpg", imageCloudPath: "lesson-materials/x.jpg" },
    { text: "b", imageFileId: "cloud://env.bucket/prompt-reading-images/other.jpg", imageCloudPath: "prompt-reading-images/x.jpg" },
    { text: "c", imageFileId: "cloud://env.bucket/prompt-reading-images/../x.jpg", imageCloudPath: "prompt-reading-images/../x.jpg" },
  ],
});
assert.ok(rejectedImages.every((item) => !item.imageFileId && !item.imageCloudPath), "foreign image paths must be dropped");

const tooMany = promptReading.normalizeItems({
  promptReadingItems: Array.from({ length: 25 }, (_, index) => ({ text: `Sentence ${index}` })),
});
assert.strictEqual(tooMany.length, promptReading.MAX_ITEMS);

// 修改提示或图片不改变签名；改句子或显示方式会改变签名。
const lesson = Object.assign({ recordingTaskType: "prompt_reading" }, task);
const hintChanged = Object.assign({}, lesson, {
  promptReadingItems: lesson.promptReadingItems.map((item) => Object.assign({}, item, { hint: "新提示", imageFileId: "", imageCloudPath: "" })),
});
assert.deepStrictEqual(promptReading.getSignatureFields(hintChanged), promptReading.getSignatureFields(lesson));
const textChanged = Object.assign({}, lesson, {
  promptReadingItems: lesson.promptReadingItems.map((item, index) => Object.assign({}, item, { text: index ? item.text : "My name is Molly." })),
});
assert.notDeepStrictEqual(promptReading.getSignatureFields(textChanged), promptReading.getSignatureFields(lesson));
assert.notDeepStrictEqual(
  promptReading.getSignatureFields(Object.assign({}, lesson, { promptReadingTextMode: "show" })),
  promptReading.getSignatureFields(lesson)
);
assert.strictEqual(promptReading.getSignatureFields({ recordingTaskType: "manual" }), null);

// 只看提示时学生拿不到原句，也拿不到云文件 ID。
const urlMap = promptReading.buildImageUrlMap([
  { status: 0, fileID: image.imageFileId, tempFileURL: "https://example.test/a.jpg" },
]);
const studentItems = promptReading.sanitizeItemsForViewer(task.promptReadingItems, urlMap, "hide", false);
assert.ok(studentItems.every((item) => !Object.prototype.hasOwnProperty.call(item, "text")), "hidden text must not reach the student");
assert.strictEqual(studentItems[0].imageUrl, "https://example.test/a.jpg");
assert.ok(!JSON.stringify(studentItems).includes("cloud://"), "student payload must not expose cloud file ids");
const revealItems = promptReading.sanitizeItemsForViewer(task.promptReadingItems, urlMap, "reveal", false);
assert.strictEqual(revealItems[1].text, "I am nine years old.");
const teacherItems = promptReading.sanitizeItemsForViewer(task.promptReadingItems, urlMap, "hide", true);
assert.strictEqual(teacherItems[0].text, "My name is Jiawen.");

// 补录计划
const ids = task.promptReadingItems.map((item) => item.id);
const firstPlan = promptReading.buildRetakePlan(task.promptReadingItems, []);
assert.strictEqual(firstPlan.mode, "full");
assert.strictEqual(firstPlan.hasFullRound, false);
assert.strictEqual(promptReading.resolveSubmissionScope(task.promptReadingItems, ids, firstPlan), "full");
assert.strictEqual(promptReading.resolveSubmissionScope(task.promptReadingItems, ids.slice(0, 2), firstPlan), "", "a first round must include every sentence");
assert.strictEqual(promptReading.resolveSubmissionScope(task.promptReadingItems, [ids[0], ids[0], ids[1]], firstPlan), "", "duplicate sentences are rejected");

const round1 = ids.map((itemId, index) => ({
  promptReadingItemId: itemId,
  batchId: "batch-1",
  createdAtMs: 1000 + index,
  status: index === 1 ? "需要重录" : index === 2 ? "朗读正确" : "待检查",
  teacherFeedback: index === 1 ? "注意 nine 的发音" : "",
}));
const retakePlan = promptReading.buildRetakePlan(task.promptReadingItems, round1);
assert.strictEqual(retakePlan.mode, "retake");
assert.deepStrictEqual(retakePlan.retakeItemIds, [ids[1]]);
assert.strictEqual(retakePlan.retakeFeedback[0].feedback, "注意 nine 的发音");
assert.strictEqual(retakePlan.roundCount, 1);
assert.strictEqual(promptReading.resolveSubmissionScope(task.promptReadingItems, [ids[1]], retakePlan), "retake");
assert.strictEqual(promptReading.resolveSubmissionScope(task.promptReadingItems, ids, retakePlan), "full", "a full round is always accepted");
assert.strictEqual(promptReading.resolveSubmissionScope(task.promptReadingItems, [ids[0]], retakePlan), "", "only flagged sentences may be retaken alone");

const round2 = round1.concat([{ promptReadingItemId: ids[1], batchId: "batch-2", createdAtMs: 2000, status: "待检查" }]);
const afterRetake = promptReading.buildRetakePlan(task.promptReadingItems, round2);
assert.strictEqual(afterRetake.mode, "full", "after the retake nothing is flagged any more");
assert.strictEqual(afterRetake.roundCount, 2);

assert.ok(promptReading.isValidSubmissionPath("prompt-reading-submissions/s/l/r/01.mp3"));
assert.ok(!promptReading.isValidSubmissionPath("lesson-submissions/s/l/r/01.mp3"));
assert.ok(!promptReading.isValidSubmissionPath("prompt-reading-submissions/../x.mp3"));

console.log("prompt-reading logic tests passed");

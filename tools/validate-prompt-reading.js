const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const app = JSON.parse(read("miniprogram", "app.json"));
const registeredSubpages = (app.subpackages || app.subPackages || []).flatMap((subpackage) => (
  (subpackage.pages || []).map((page) => `${subpackage.root}/${page}`)
));
assert.ok(registeredSubpages.includes("follow-reading/pages/prompt-reading/index"), "prompt-reading page is not registered");

const cloudIndex = read("cloudfunctions", "quickstartFunctions", "index.js");
const logic = read("cloudfunctions", "quickstartFunctions", "promptReading.js");
const service = read("cloudfunctions", "quickstartFunctions", "promptReadingService.js");
const options = read("miniprogram", "utils", "lessonTaskOptions.js");
const imageUpload = read("miniprogram", "utils", "promptReadingImage.js");
const fieldsJs = read("miniprogram", "components", "lesson-task-fields", "index.js");
const fieldsWxml = read("miniprogram", "components", "lesson-task-fields", "index.wxml");
const addLesson = read("miniprogram", "pages", "add-lesson", "index.js");
const lessonDetail = read("miniprogram", "pages", "lesson-detail", "index.js");
const lessonDetailWxml = read("miniprogram", "pages", "lesson-detail", "index.wxml");
const practice = read("miniprogram", "follow-reading", "pages", "prompt-reading", "index.js");
const practiceWxml = read("miniprogram", "follow-reading", "pages", "prompt-reading", "index.wxml");

// 云端：操作、类型、存储目录、安全检查
[
  "getPromptReadingPractice",
  "submitPromptReadingBatch",
  "reviewLessonRecordingBatch",
].forEach((action) => assert.ok(cloudIndex.includes(`case "${action}"`), `cloud action ${action} is missing`));
assert.ok(cloudIndex.includes('"prompt_reading"'), "lesson payload does not accept prompt_reading");
assert.ok(cloudIndex.includes("PROMPT_READING_REQUIRES_FLOW"), "single-recording endpoint must reject prompt_reading");
assert.ok(cloudIndex.includes("promptReading.collectImageFileIds(lessonPayload.promptReadingItems)"), "new lesson images are not safety-checked");
assert.ok(cloudIndex.includes("removedPromptImageIds"), "replaced prompt images are not cleaned up");
assert.ok(cloudIndex.includes("promptReading.collectImageFileIds(lesson.promptReadingItems)"), "deleting a lesson must remove prompt images");
assert.ok(cloudIndex.includes("decorateLessonForViewer"), "lesson detail does not resolve prompt images");
assert.ok(logic.includes('"prompt-reading-images/"') && logic.includes('"prompt-reading-submissions/"'), "storage prefixes are missing");
assert.ok(logic.includes('textMode !== "hide"'), "hide mode must strip sentence text for students");
assert.ok(service.includes('identity.role !== "student"'), "teacher preview is not blocked from submitting");
assert.ok(service.includes('recordingMode: "prompt_reading"'), "submissions are not tagged as prompt_reading");
assert.ok(service.includes("resolveSubmissionScope"), "submission scope (full / retake) is not validated");
assert.ok(service.includes("runTransaction("), "batch submission must use the retrying transaction helper");

// 老师布置
assert.ok(options.includes('value: "prompt_reading"'), "recording type option is missing");
assert.ok(options.includes("parsePromptReadingLines") && options.includes("toPromptReadingPayload"), "bulk paste / payload helpers are missing");
assert.ok(fieldsJs.includes("addPromptItem") && fieldsJs.includes("movePromptItem") && fieldsJs.includes("choosePromptImage"), "sentence card editor actions are missing");
assert.ok(fieldsWxml.includes("批量粘贴") && fieldsWxml.includes("+ 添加一句") && fieldsWxml.includes("学生怎么看原句"), "sentence editor UI is incomplete");
assert.ok(imageUpload.includes("prompt-reading-images/") && imageUpload.includes("compressImage"), "prompt images must be compressed and uploaded to their own folder");
[addLesson, lessonDetail].forEach((source) => {
  assert.ok(source.includes("getPromptReadingFormError"), "lesson forms must validate prompt sentences");
  assert.ok(source.includes("toPromptReadingPayload"), "lesson forms must send cleaned prompt sentences");
});

// 学生逐句录音
assert.ok(practice.includes("getPromptReadingPractice") && practice.includes("submitPromptReadingBatch"), "student page does not use the prompt-reading actions");
assert.ok(practice.includes("prompt-reading-submissions/"), "student uploads go to the wrong folder");
assert.ok(practice.includes("playItem") && practice.includes("rerecord") && practice.includes("revealText"), "playback / re-record / reveal are missing");
assert.ok(practice.includes("this.uploadedByItemId[item.id]"), "retrying a submission must skip already uploaded sentences");
assert.ok(practice.includes("isTeacherPreview"), "teacher preview handling is missing");
assert.ok(practiceWxml.includes("开始朗读") && practiceWxml.includes("回放") && practiceWxml.includes("重录") && practiceWxml.includes("提交全部"), "sentence card controls are missing");
assert.ok(practiceWxml.includes("开始补录"), "retake mode entry is missing");

// 老师逐句查看
assert.ok(lessonDetail.includes("/follow-reading/pages/prompt-reading/index"), "lesson detail cannot open the prompt-reading page");
assert.ok(lessonDetail.includes("reviewLessonRecordingBatch") && lessonDetailWxml.includes("reviewRecordingRound"), "round batch review is missing");
assert.ok(lessonDetailWxml.includes("看提示朗读"), "lesson detail does not label the new task type");

console.log("prompt-reading validation passed");

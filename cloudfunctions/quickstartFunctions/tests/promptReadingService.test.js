const assert = require("assert");
const promptReading = require("../promptReading");
const { createPromptReadingService } = require("../promptReadingService");

// 内存数据库：只实现服务用到的 doc/get/set/update、where/skip/limit/get 和事务。
const createMemoryDb = (initial) => {
  const collections = new Map();
  Object.keys(initial).forEach((name) => {
    collections.set(name, new Map(Object.entries(initial[name]).map(([id, doc]) => [id, Object.assign({ _id: id }, doc)])));
  });
  const collection = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    const store = collections.get(name);
    return {
      doc: (id) => ({
        get: async () => ({ data: store.has(id) ? Object.assign({}, store.get(id)) : null }),
        set: async ({ data }) => { store.set(id, Object.assign({ _id: id }, data)); },
        update: async ({ data }) => { store.set(id, Object.assign({}, store.get(id), data)); },
      }),
      where: (query) => {
        let skip = 0;
        let limit = 100;
        const chain = {
          skip: (value) => { skip = value; return chain; },
          limit: (value) => { limit = value; return chain; },
          get: async () => ({
            data: Array.from(store.values())
              .filter((doc) => Object.keys(query).every((key) => doc[key] === query[key]))
              .slice(skip, skip + limit),
          }),
        };
        return chain;
      },
    };
  };
  return {
    collections,
    collection,
    serverDate: () => "server-date",
    runTransaction: async (callback) => callback({ collection }),
  };
};

const items = promptReading.normalizeItems({
  promptReadingItems: [
    { text: "My name is Jiawen.", hint: "名字" },
    { text: "I am nine years old.", hint: "年龄" },
    { text: "I like apples.", hint: "喜欢的水果" },
  ],
});
const db = createMemoryDb({
  lessons: {
    "lesson-1": {
      studentId: "student-1",
      title: "第 5 课",
      lessonDate: "2026-11-23",
      lessonNo: "5",
      recordingTaskEnabled: true,
      recordingTaskType: "prompt_reading",
      promptReadingTextMode: "hide",
      promptReadingResponseSeconds: 20,
      promptReadingItems: items,
      homeworkTaskVersion: 1,
    },
  },
  students: { "student-1": { name: "冯嘉文" } },
  lessonSubmissions: {},
});

let identity = { role: "student", student: { _id: "student-1", name: "冯嘉文" } };
const createError = (code, message) => Object.assign(new Error(message), { code });
const service = createPromptReadingService({
  db,
  cloud: { getTempFileURL: async () => ({ fileList: [] }) },
  courseWorkflow: { isLateHomeworkSubmission: () => false },
  createError,
  createOneCollection: async () => {},
  ensureEnglishCourseAccess: () => {},
  ensureStudentAccess: async () => {},
  getIdentity: async () => identity,
  getOptionalTransactionDocument: async (ref) => (await ref.get()).data,
  runTransaction: (callback) => db.runTransaction(callback),
});

const response = (item, suffix) => ({
  itemId: item.id,
  fileID: `cloud://env.bucket/prompt-reading-submissions/s/l/${suffix}/${item.order}.mp3`,
  cloudPath: `prompt-reading-submissions/s/l/${suffix}/${item.order}.mp3`,
  duration: 3200,
  fileSize: 20000,
});
const submissions = () => Array.from(db.collections.get("lessonSubmissions").values());

(async () => {
  // 学生第一次进入：整轮录，只看提示时没有原句。
  const practice = await service.getPractice({ data: { lessonId: "lesson-1" } });
  assert.strictEqual(practice.plan.mode, "full");
  assert.strictEqual(practice.task.items.length, 3);
  assert.ok(practice.task.items.every((item) => !("text" in item)), "hide mode must not send sentence text");

  // 少一句不能提交。
  await assert.rejects(
    service.submitBatch({ data: { lessonId: "lesson-1", requestId: "r1", responses: items.slice(0, 2).map((item) => response(item, "r1")) } }),
    /每一句都录完/
  );
  // 上传到其他目录会被拒绝。
  await assert.rejects(
    service.submitBatch({ data: { lessonId: "lesson-1", requestId: "r1", responses: items.map((item) => Object.assign(response(item, "r1"), { cloudPath: "lesson-submissions/x.mp3" })) } }),
    /没有上传成功/
  );

  const first = await service.submitBatch({ data: { lessonId: "lesson-1", requestId: "r1", responses: items.map((item) => response(item, "r1")) } });
  assert.strictEqual(first.attemptNo, 1);
  assert.strictEqual(first.scope, "full");
  assert.strictEqual(submissions().length, 3);
  assert.ok(submissions().every((item) => item.recordingMode === "prompt_reading" && item.status === "待检查"));
  assert.strictEqual(submissions().find((item) => item.promptReadingItemOrder === 2).promptReadingItemHint, "年龄");

  // 同一请求重发不会重复写入。
  const repeated = await service.submitBatch({ data: { lessonId: "lesson-1", requestId: "r1", responses: items.map((item) => response(item, "r1")) } });
  assert.strictEqual(repeated.alreadySubmitted, true);
  assert.strictEqual(submissions().length, 3);

  // 老师把第 2 句标为需要重录 → 学生只补录这一句。
  const second = submissions().find((item) => item.promptReadingItemOrder === 2);
  db.collections.get("lessonSubmissions").set(second._id, Object.assign({}, second, { status: "需要重录", teacherFeedback: "注意 nine" }));
  const retakePractice = await service.getPractice({ data: { lessonId: "lesson-1" } });
  assert.strictEqual(retakePractice.plan.mode, "retake");
  assert.deepStrictEqual(retakePractice.plan.retakeItemIds, [items[1].id]);
  assert.strictEqual(retakePractice.plan.retakeFeedback[0].feedback, "注意 nine");
  await assert.rejects(
    service.submitBatch({ data: { lessonId: "lesson-1", requestId: "r2", responses: [response(items[0], "r2")] } }),
    /需要重录的全部句子/
  );
  const retake = await service.submitBatch({ data: { lessonId: "lesson-1", requestId: "r2", responses: [response(items[1], "r2")] } });
  assert.strictEqual(retake.scope, "retake");
  assert.strictEqual(retake.attemptNo, 2);
  assert.strictEqual(submissions().length, 4);
  const afterRetake = await service.getPractice({ data: { lessonId: "lesson-1" } });
  assert.strictEqual(afterRetake.plan.mode, "full");

  // 教师预览可以打开但不能提交；老师不走预览入口不能打开学生页。
  identity = { role: "teacher" };
  const preview = await service.getPractice({ data: { lessonId: "lesson-1", mode: "teacherPreview", previewStudentId: "student-1" } });
  assert.strictEqual(preview.isTeacherPreview, true);
  await assert.rejects(service.getPractice({ data: { lessonId: "lesson-1" } }), /教师预览入口/);
  await assert.rejects(
    service.submitBatch({ data: { lessonId: "lesson-1", mode: "teacherPreview", requestId: "r3", responses: items.map((item) => response(item, "r3")) } }),
    /教师预览/
  );

  // 老师课程页：原句保留；学生课程页在只看提示时去掉原句。
  const lesson = (await db.collection("lessons").doc("lesson-1").get()).data;
  const teacherView = await service.decorateLessonForViewer(lesson, true);
  assert.strictEqual(teacherView.promptReadingItems[0].text, "My name is Jiawen.");
  const studentView = await service.decorateLessonForViewer(lesson, false);
  assert.ok(studentView.promptReadingItems.every((item) => !("text" in item)));

  console.log("prompt-reading service tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

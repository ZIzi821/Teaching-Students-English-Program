const crypto = require("crypto");
const promptReading = require("./promptReading");

const createPromptReadingService = ({
  db,
  cloud,
  courseWorkflow,
  createError,
  createOneCollection,
  ensureEnglishCourseAccess,
  ensureStudentAccess,
  getIdentity,
  getOptionalTransactionDocument,
  runTransaction,
}) => {
  const loadAllByField = async (collectionName, field, value) => {
    const documents = [];
    const pageSize = 100;
    for (let skip = 0; ; skip += pageSize) {
      const result = await db.collection(collectionName).where({ [field]: value }).skip(skip).limit(pageSize).get();
      const items = result.data || [];
      documents.push(...items);
      if (items.length < pageSize) break;
    }
    return documents;
  };

  const loadImageUrlMap = async (items) => {
    const fileIDs = promptReading.collectImageFileIds(items);
    const fileList = [];
    for (let offset = 0; offset < fileIDs.length; offset += 50) {
      try {
        const result = await cloud.getTempFileURL({ fileList: fileIDs.slice(offset, offset + 50) });
        fileList.push(...(result.fileList || []));
      } catch (err) {
        console.error("get prompt-reading image urls failed", err);
      }
    }
    return promptReading.buildImageUrlMap(fileList);
  };

  // 课程页展示用：附上图片临时地址；学生端在“只看提示”时去掉原句。
  const decorateLessonForViewer = async (lesson, isTeacherViewer) => {
    if (!lesson || lesson.recordingTaskType !== "prompt_reading") return lesson;
    const task = promptReading.normalizeTask(lesson);
    const urlByFileID = await loadImageUrlMap(task.promptReadingItems);
    const items = promptReading.sanitizeItemsForViewer(
      task.promptReadingItems,
      urlByFileID,
      task.promptReadingTextMode,
      isTeacherViewer
    ).map((item, index) => Object.assign({}, item, isTeacherViewer ? {
      imageFileId: task.promptReadingItems[index].imageFileId,
      imageCloudPath: task.promptReadingItems[index].imageCloudPath,
    } : {}));
    return Object.assign({}, lesson, {
      promptReadingTextMode: task.promptReadingTextMode,
      promptReadingResponseSeconds: task.promptReadingResponseSeconds,
      promptReadingItems: items,
    });
  };

  const getAssignedLesson = async (lessonId, data = {}) => {
    if (!lessonId) throw createError("INVALID_LESSON", "课程信息不完整，请返回后重试");
    const identity = await getIdentity();
    if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
    const lessonResult = await db.collection("lessons").doc(lessonId).get();
    const lesson = lessonResult.data;
    if (!lesson || lesson.deleting === true) throw createError("LESSON_NOT_FOUND", "课程不存在或已删除");
    if (lesson.recordingTaskEnabled !== true || lesson.recordingTaskType !== "prompt_reading") {
      throw createError("PROMPT_READING_NOT_ASSIGNED", "老师还没有为这节课布置看提示朗读");
    }
    const isTeacherPreview = identity.role === "teacher" && data.mode === "teacherPreview";
    if (identity.role === "teacher" && !isTeacherPreview) {
      throw createError("PERMISSION_DENIED", "请从教师预览入口进入学生朗读页");
    }
    if (isTeacherPreview && data.previewStudentId && lesson.studentId !== data.previewStudentId) {
      throw createError("PERMISSION_DENIED", "请从对应学生的课程页进入朗读任务");
    }
    if (identity.role === "student" && (!identity.student || identity.student._id !== lesson.studentId)) {
      throw createError("PERMISSION_DENIED", "请使用当前学生账号完成朗读任务");
    }
    await ensureStudentAccess(lesson.studentId);
    const studentResult = await db.collection("students").doc(lesson.studentId).get();
    if (!studentResult.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    ensureEnglishCourseAccess(identity, studentResult.data, data);
    const task = promptReading.normalizeTask(lesson);
    if (!task.promptReadingItems.length) {
      throw createError("PROMPT_READING_EMPTY", "朗读句子为空，请联系老师重新布置");
    }
    return { identity, isTeacherPreview, lesson, student: studentResult.data, task };
  };

  const loadCurrentSubmissions = async (lesson) => {
    await createOneCollection("lessonSubmissions");
    const taskVersion = Math.max(1, Number(lesson.homeworkTaskVersion) || 1);
    return (await loadAllByField("lessonSubmissions", "lessonId", lesson._id))
      .filter((item) => (
        item.studentId === lesson.studentId
        && item.recordingMode === "prompt_reading"
        && Number(item.homeworkTaskVersion || 1) === taskVersion
      ));
  };

  const getPractice = async (event) => {
    const data = event.data || {};
    const lessonId = String(data.lessonId || "").trim();
    const context = await getAssignedLesson(lessonId, data);
    const submissions = await loadCurrentSubmissions(context.lesson);
    const plan = promptReading.buildRetakePlan(context.task.promptReadingItems, submissions);
    const urlByFileID = await loadImageUrlMap(context.task.promptReadingItems);
    return {
      success: true,
      role: context.identity.role,
      isTeacherPreview: context.isTeacherPreview,
      lesson: {
        _id: context.lesson._id,
        title: context.lesson.title || "英语课",
        lessonDate: context.lesson.lessonDate || "",
        lessonNo: context.lesson.lessonNo || "",
        recordingPrompt: context.lesson.recordingPrompt || "",
        homeworkTaskVersion: Math.max(1, Number(context.lesson.homeworkTaskVersion) || 1),
      },
      student: { _id: context.student._id, name: context.student.name || "学生" },
      task: {
        textMode: context.task.promptReadingTextMode,
        responseSeconds: context.task.promptReadingResponseSeconds,
        items: promptReading.sanitizeItemsForViewer(
          context.task.promptReadingItems,
          urlByFileID,
          context.task.promptReadingTextMode,
          false
        ),
      },
      plan: {
        mode: plan.mode,
        hasFullRound: plan.hasFullRound,
        roundCount: plan.roundCount,
        retakeItemIds: plan.retakeItemIds,
        retakeFeedback: plan.retakeFeedback,
      },
    };
  };

  const normalizeResponses = (task, responses) => {
    const maxDurationMs = (task.promptReadingResponseSeconds + 2) * 1000;
    return (Array.isArray(responses) ? responses : []).map((response) => {
      const item = task.promptReadingItems.find((candidate) => candidate.id === String(response && response.itemId || ""));
      if (!item) throw createError("INVALID_PROMPT_READING_RESPONSES", "朗读内容已经变化，请返回课程页重新进入");
      const fileID = String(response.fileID || "").trim();
      const cloudPath = String(response.cloudPath || "").trim().slice(0, 500);
      if (!fileID || !promptReading.isValidSubmissionPath(cloudPath)) {
        throw createError("INVALID_PROMPT_READING_RESPONSES", "有一句录音没有上传成功，请重新提交");
      }
      const duration = Math.max(0, Math.min(maxDurationMs, Number(response.duration) || 0));
      if (duration < 300) {
        throw createError("INVALID_PROMPT_READING_RESPONSES", `第 ${item.order} 句录音太短，请重录这一句`);
      }
      return {
        itemId: item.id,
        itemOrder: item.order,
        itemText: item.text,
        itemHint: item.hint,
        fileID,
        cloudPath,
        fileName: String(response.fileName || `${item.id}.mp3`).slice(0, 180),
        duration,
        fileSize: Math.max(0, Number(response.fileSize) || 0),
      };
    }).sort((left, right) => left.itemOrder - right.itemOrder);
  };

  const submitBatch = async (event) => {
    const identity = await getIdentity();
    if (identity.role !== "student" || !identity.student) {
      throw createError("PERMISSION_DENIED", "当前为教师预览，请使用学生账号提交朗读录音");
    }
    const data = event.data || {};
    const lessonId = String(data.lessonId || "").trim();
    const context = await getAssignedLesson(lessonId, data);
    const responses = normalizeResponses(context.task, data.responses);
    const requestId = String(data.requestId || "").trim().slice(0, 100);
    if (!requestId) throw createError("INVALID_PROMPT_READING_REQUEST", "本次朗读记录不完整，请重新提交");
    const taskVersion = Math.max(1, Number(context.lesson.homeworkTaskVersion) || 1);
    const batchId = `prompt_batch_${crypto.createHash("sha1")
      .update(`${identity.student._id}\n${lessonId}\n${taskVersion}\n${requestId}`)
      .digest("hex")}`;
    const currentSubmissions = await loadCurrentSubmissions(context.lesson);
    const existing = currentSubmissions.filter((item) => item.batchId === batchId);
    if (existing.length && existing.length >= responses.length) {
      return {
        success: true,
        alreadySubmitted: true,
        batchId,
        attemptNo: Math.max(1, Number(existing[0].attemptNo) || 1),
        scope: existing[0].promptReadingScope || "full",
        submittedLate: existing.some((item) => item.submittedLate === true),
      };
    }
    const plan = promptReading.buildRetakePlan(context.task.promptReadingItems, currentSubmissions);
    const scope = promptReading.resolveSubmissionScope(
      context.task.promptReadingItems,
      responses.map((response) => response.itemId),
      plan
    );
    if (!scope) {
      throw createError(
        "INVALID_PROMPT_READING_RESPONSES",
        plan.mode === "retake" ? "请录完老师标记需要重录的全部句子后再提交" : "请把每一句都录完后再提交"
      );
    }
    const attemptNo = plan.roundCount + 1;
    const submittedAtMs = Date.now();
    const submittedLate = courseWorkflow.isLateHomeworkSubmission(context.lesson, submittedAtMs);
    await runTransaction(async (transaction) => {
      const lessonRef = transaction.collection("lessons").doc(lessonId);
      const currentLesson = await getOptionalTransactionDocument(lessonRef);
      if (
        !currentLesson
        || currentLesson.deleting === true
        || currentLesson.studentId !== identity.student._id
        || currentLesson.recordingTaskEnabled !== true
        || currentLesson.recordingTaskType !== "prompt_reading"
        || Number(currentLesson.homeworkTaskVersion || 1) !== taskVersion
      ) throw createError("PROMPT_READING_NOT_ASSIGNED", "朗读任务已经变化，请返回课程页重新进入");
      for (let index = 0; index < responses.length; index += 1) {
        const response = responses[index];
        const submissionId = `submission_${crypto.createHash("sha1")
          .update(`${batchId}\n${response.itemId}`)
          .digest("hex")}`;
        await transaction.collection("lessonSubmissions").doc(submissionId).set({
          data: {
            studentId: identity.student._id,
            lessonId,
            kind: "audio",
            recordingMode: "prompt_reading",
            promptReadingItemId: response.itemId,
            promptReadingItemOrder: response.itemOrder,
            promptReadingItemText: response.itemText,
            promptReadingItemHint: response.itemHint,
            promptReadingScope: scope,
            batchId,
            fileID: response.fileID,
            fileName: response.fileName,
            fileSize: response.fileSize,
            duration: response.duration,
            cloudPath: response.cloudPath,
            organizedVersion: 2,
            studentNameSnapshot: String(identity.student.name || "学生").slice(0, 100),
            lessonTitleSnapshot: String(currentLesson.title || "英语课").slice(0, 200),
            lessonDateSnapshot: String(currentLesson.lessonDate || "").slice(0, 30),
            lessonNoSnapshot: String(currentLesson.lessonNo || "").slice(0, 30),
            homeworkTaskVersion: taskVersion,
            attemptNo,
            status: "待检查",
            teacherFeedback: "",
            submittedLate,
            createdAt: db.serverDate(),
            createdAtMs: submittedAtMs + index,
          },
        });
      }
      const firstSubmittedAtMs = Number(currentLesson.homeworkFirstSubmittedAtMs || 0) || submittedAtMs;
      await lessonRef.update({
        data: {
          homeworkFirstSubmittedAtMs: firstSubmittedAtMs,
          homeworkLastSubmittedAtMs: submittedAtMs,
          homeworkSubmittedLate: courseWorkflow.isLateHomeworkSubmission(currentLesson, firstSubmittedAtMs),
        },
      });
    });
    return { success: true, batchId, attemptNo, scope, submittedLate };
  };

  return {
    decorateLessonForViewer,
    getPractice,
    submitBatch,
  };
};

module.exports = { createPromptReadingService };

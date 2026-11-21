// 记忆调度校准的状态文案：管理页、背词页和评估页共用，避免同一个孩子在不同页面显示不同结论。
// 只有服务端给出可应用的建议时才显示“需要校准”；有偏差但未达到确认标准时显示“继续观察”。
const describeCalibrationStatus = (evaluation) => {
  if (!evaluation || !evaluation.status) return { tone: "unknown", label: "暂不可用" };
  const status = evaluation.status;
  const calibration = evaluation.calibration || {};
  if (calibration.canApply) return { tone: "attention", label: "需要校准" };
  if (calibration.reviewReady) return { tone: "attention", label: "可复查" };
  if (calibration.applied === true && calibration.isDefault === false) return { tone: "stable", label: "已校准" };
  if (status.key === "needs_calibration") return { tone: "collecting", label: "继续观察" };
  return { tone: status.tone || "collecting", label: status.label || "收集中" };
};

module.exports = {
  describeCalibrationStatus,
};

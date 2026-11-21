// “阶段 0”是复课回顾与诊断，不计入正式阶段编号；正式阶段按配置里的“第 N 阶段”显示。
const isPreparatoryStage = (stage) => /^阶段\s*0$/.test(String(stage && stage.stageLabel || "").trim());

const describeStagePosition = (stageOptions, currentStageId) => {
  const stages = Array.isArray(stageOptions) ? stageOptions : [];
  const formalStages = stages.filter((stage) => !isPreparatoryStage(stage));
  const current = stages.find((stage) => stage.stageId === currentStageId) || formalStages[0] || stages[0] || {};
  const formalIndex = formalStages.findIndex((stage) => stage.stageId === current.stageId);
  return {
    isPreparatory: formalIndex < 0,
    stageNumber: formalIndex + 1,
    stageCount: formalStages.length,
    positionText: formalIndex < 0
      ? `${current.stageLabel || "准备阶段"} · 正式阶段前`
      : `第 ${formalIndex + 1} / ${formalStages.length} 阶段`,
    steps: formalStages.map((stage, index) => ({
      stageId: stage.stageId,
      state: formalIndex < 0 || index > formalIndex ? "next" : index === formalIndex ? "current" : "done",
    })),
  };
};

module.exports = {
  describeStagePosition,
  isPreparatoryStage,
};

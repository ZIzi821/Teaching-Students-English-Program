// 看提示朗读的提示图片：选择一张图，压缩到最长边 750px（满足微信图片安全检查的尺寸要求），上传到 prompt-reading-images/。
const MAX_EDGE = 750;

const isCancel = (error) => /cancel/i.test(String(error && error.errMsg || ""));

const chooseImage = () => new Promise((resolve, reject) => {
  wx.chooseMedia({
    count: 1,
    mediaType: ["image"],
    sourceType: ["album", "camera"],
    sizeType: ["compressed"],
    success: (res) => resolve(res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath || ""),
    fail: (error) => (isCancel(error) ? resolve("") : reject(error)),
  });
});

const getImageInfo = (src) => new Promise((resolve) => {
  if (typeof wx.getImageInfo !== "function") {
    resolve(null);
    return;
  }
  wx.getImageInfo({ src, success: resolve, fail: () => resolve(null) });
});

const compressImage = (src) => {
  if (typeof wx.compressImage !== "function") return Promise.resolve(src);
  return getImageInfo(src).then((info) => {
    const width = Math.max(0, Number(info && info.width) || 0);
    const height = Math.max(0, Number(info && info.height) || 0);
    const sizeOptions = width >= height
      ? (width > MAX_EDGE ? { compressedWidth: MAX_EDGE } : {})
      : (height > MAX_EDGE ? { compressedHeight: MAX_EDGE } : {});
    return new Promise((resolve) => {
      wx.compressImage(Object.assign({
        src,
        quality: 70,
        success: (res) => resolve(res.tempFilePath || src),
        fail: () => resolve(src),
      }, sizeOptions));
    });
  });
};

const buildCloudPath = (localPath) => {
  const extensionMatch = String(localPath || "").toLowerCase().match(/\.(jpe?g|png|webp)$/);
  const extension = extensionMatch ? extensionMatch[1].replace("jpeg", "jpg") : "jpg";
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const random = Math.random().toString(36).slice(2, 10);
  return `prompt-reading-images/${month}/${Date.now()}-${random}.${extension}`;
};

// 返回 { fileID, cloudPath, localPath }；老师取消选择时返回 null。
const uploadPromptReadingImage = () => chooseImage().then((picked) => {
  if (!picked) return null;
  return compressImage(picked).then((localPath) => {
    const cloudPath = buildCloudPath(localPath);
    return wx.cloud.uploadFile({ cloudPath, filePath: localPath }).then((upload) => ({
      fileID: upload.fileID,
      cloudPath,
      localPath,
    }));
  });
});

module.exports = { buildCloudPath, uploadPromptReadingImage };
